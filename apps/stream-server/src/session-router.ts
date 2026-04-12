import type { Server, Socket } from 'socket.io';
import {
  FRAME_HEADER_LENGTH_BYTES,
  GCM_TAG_LENGTH_BYTES,
  SEQUENCE_MAX,
  VOICE_NAMESPACE,
  VoiceControlSchema,
} from '@realtime-voice-infra/shared-types';
import {
  type SessionCryptoContext,
  createSessionCrypto,
  decryptFrame,
  deriveFrameKey,
} from '@realtime-voice-infra/session-core';
import { BackpressureTracker } from './backpressure.js';
import type { Config } from './config.js';
import { rootLogger, runWithLogContext, updateLogContext } from './logger.js';
import { metrics } from './metrics.js';
import type { SessionStore } from './session-store.js';

interface AuthedSocketData {
  sessionId: string;
}

interface PerSessionState {
  crypto: SessionCryptoContext;
  expectedSequence: number;
  decryptFailures: number;
  backpressure: BackpressureTracker;
  startedAt: number;
}

const MAX_DECRYPT_FAILURES = 3;

export function attachSessionRouter(
  io: Server,
  store: SessionStore,
  config: Config,
): void {
  const nsp = io.of(VOICE_NAMESPACE);

  nsp.on('connection', (socket: Socket) => {
    const { sessionId } = socket.data as AuthedSocketData;
    runWithLogContext({ session_id: sessionId }, () => {
      void handleConnection(socket, sessionId, store, config);
    });
  });
}

async function handleConnection(
  socket: Socket,
  sessionId: string,
  store: SessionStore,
  config: Config,
): Promise<void> {
  const stored = await store.getSession(sessionId);
  if (!stored) {
    socket.emit('voice.error', {
      code: 'AUTH_FAILED',
      message: 'session not found',
    });
    socket.disconnect(true);
    return;
  }

  const frameKey = deriveFrameKey(stored.sessionKey, sessionId);
  const state: PerSessionState = {
    crypto: createSessionCrypto(sessionId, frameKey),
    expectedSequence: 0,
    decryptFailures: 0,
    backpressure: new BackpressureTracker({
      thresholdBytes: config.backpressureThresholdBytes,
      resumeBytes: config.backpressureResumeBytes,
    }),
    startedAt: Date.now(),
  };

  void socket.join(`session:${sessionId}`);
  rootLogger.info('session connected');

  socket.on('voice.control', (payload: unknown) => {
    const result = VoiceControlSchema.safeParse(payload);
    if (!result.success) {
      socket.emit('voice.error', {
        code: 'VALIDATION_FAILED',
        message: result.error.message,
      });
      return;
    }
    rootLogger.info({ control: result.data.type }, 'control received');
    if (result.data.type === 'stop') {
      socket.disconnect(true);
    }
  });

  socket.on('voice.frame', (frame: Buffer | ArrayBuffer) => {
    const buf = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
    handleFrame(socket, state, store, sessionId, buf);
  });

  socket.on('disconnect', async () => {
    rootLogger.info(
      { duration_ms: Date.now() - state.startedAt },
      'session disconnected',
    );
    await store.deleteSession(sessionId);
  });
}

function handleFrame(
  socket: Socket,
  state: PerSessionState,
  store: SessionStore,
  sessionId: string,
  envelope: Buffer,
): void {
  if (envelope.length < FRAME_HEADER_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES) {
    socket.emit('voice.error', {
      code: 'VALIDATION_FAILED',
      message: 'frame envelope truncated',
    });
    return;
  }

  const seq = envelope.readUInt32BE(0);
  updateLogContext({ frame_sequence: seq });

  if (seq === SEQUENCE_MAX) {
    socket.emit('voice.control', { type: 'stop', session_id: sessionId });
    socket.emit('voice.error', {
      code: 'SEQUENCE_EXHAUSTED',
      message: 'sequence rollover; session must re-init',
      sequence: seq,
    });
    socket.disconnect(true);
    return;
  }

  if (seq !== state.expectedSequence) {
    metrics.droppedFrames.add(1);
    socket.emit('voice.error', {
      code: 'SEQUENCE_GAP',
      message: `expected ${state.expectedSequence} got ${seq}`,
      sequence: seq,
    });
    // Resync to the received sequence so a single loss is recoverable.
    state.expectedSequence = seq + 1;
    return;
  }

  try {
    decryptFrame(state.crypto, envelope);
  } catch (_err) {
    state.decryptFailures += 1;
    metrics.droppedFrames.add(1);
    socket.emit('voice.error', {
      code: 'DECRYPT_FAILED',
      message: 'gcm auth failed',
      sequence: seq,
    });
    if (state.decryptFailures >= MAX_DECRYPT_FAILURES) {
      rootLogger.warn('terminating session after consecutive decrypt failures');
      socket.disconnect(true);
    }
    return;
  }

  state.decryptFailures = 0;
  state.expectedSequence = seq + 1;
  metrics.framesReceived.add(1);
  metrics.bytesReceived.add(envelope.length);

  const pauseEvt = state.backpressure.add(envelope.length);
  if (pauseEvt?.type === 'pause') {
    metrics.pauseEvents.add(1);
    socket.emit('voice.pause', {
      buffer_bytes: pauseEvt.bufferBytes,
      threshold_bytes: pauseEvt.thresholdBytes,
    });
  }

  // Stub: in a real integration the adapter consumes the frame; here we
  // release immediately so backpressure stays reactive to ingest rate
  // rather than to adapter latency.
  queueMicrotask(() => {
    const resumeEvt = state.backpressure.release(envelope.length);
    if (resumeEvt?.type === 'resume') {
      socket.emit('voice.resume', { buffer_bytes: resumeEvt.bufferBytes });
    }
  });

  socket.emit('voice.ack', { sequence: seq, received_at: Date.now() });
  void store; // future: refresh TTL
}
