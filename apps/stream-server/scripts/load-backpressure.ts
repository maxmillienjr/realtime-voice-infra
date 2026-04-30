/**
 * Backpressure load runner.
 *
 * Spawns N concurrent socket.io clients against a running stream-server,
 * each emitting AES-GCM-encrypted `voice.frame`s at a fixed rate. Reads
 * session keys from the same Redis the server uses (port-mapped from
 * docker-compose) so the runner can produce real encrypted frames without
 * weakening the production /session/init contract.
 *
 * Pass/fail is gated on ack ratio + decrypt/auth errors. Pause/resume and
 * sequence gaps are not failures — backpressure firing is the whole point.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import Redis from 'ioredis';
import { io as clientIO, type Socket as ClientSocket } from 'socket.io-client';
import {
  createSessionCrypto,
  deriveFrameKey,
  encryptFrame,
} from '@realtime-voice-infra/session-core';
import {
  VOICE_NAMESPACE,
  type SessionInitResponse,
} from '@realtime-voice-infra/shared-types';

interface Summary {
  vus: number;
  duration_s: number;
  frames_per_second: number;
  frames_sent: number;
  acks_received: number;
  ack_ratio: number;
  pauses: number;
  resumes: number;
  errors_by_code: Record<string, number>;
  p50_ack_ms: number;
  p95_ack_ms: number;
  p99_ack_ms: number;
}

const STREAM_SERVER_URL = process.env.STREAM_SERVER_URL ?? 'http://localhost:3000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const VUS = Number(process.env.VUS ?? 100);
const DURATION_S = Number(process.env.DURATION_S ?? 60);
const FRAMES_PER_SECOND = Number(process.env.FRAMES_PER_SECOND ?? 50);
const SUMMARY_PATH = process.env.SUMMARY_PATH ?? 'summary.json';
const PCM_BYTES = 640; // 320 samples @ 16-bit, matches the worklet frame.

const synthetic = Buffer.alloc(PCM_BYTES);
for (let i = 0; i < PCM_BYTES; i += 2) {
  synthetic.writeInt16LE(Math.floor(Math.sin(i / 16) * 1000), i);
}

interface VuStats {
  framesSent: number;
  acksReceived: number;
  pauses: number;
  resumes: number;
  errors: Map<string, number>;
  latencies: number[];
}

function newStats(): VuStats {
  return {
    framesSent: 0,
    acksReceived: 0,
    pauses: 0,
    resumes: 0,
    errors: new Map(),
    latencies: [],
  };
}

async function fetchSessionKey(redis: Redis, sessionId: string): Promise<Buffer> {
  const v = await redis.get(`sess:${sessionId}`);
  if (!v) throw new Error(`session key not found in redis for ${sessionId}`);
  return Buffer.from(v, 'base64');
}

async function initSession(): Promise<SessionInitResponse> {
  const res = await fetch(`${STREAM_SERVER_URL}/session/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`/session/init returned ${res.status}`);
  return (await res.json()) as SessionInitResponse;
}

async function runVu(redis: Redis, deadline: number, stats: VuStats): Promise<void> {
  const { jwt, session_id } = await initSession();
  const sessionKey = await fetchSessionKey(redis, session_id);
  const frameKey = deriveFrameKey(sessionKey, session_id);
  const ctx = createSessionCrypto(session_id, frameKey);

  const client: ClientSocket = clientIO(`${STREAM_SERVER_URL}${VOICE_NAMESPACE}`, {
    auth: { token: jwt },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', (err) => reject(err));
  });

  const sentAt = new Map<number, number>();

  client.on('voice.ack', (msg: { sequence: number }) => {
    const t = sentAt.get(msg.sequence);
    if (t !== undefined) {
      stats.latencies.push(performance.now() - t);
      sentAt.delete(msg.sequence);
      stats.acksReceived += 1;
    }
  });
  client.on('voice.pause', () => {
    stats.pauses += 1;
  });
  client.on('voice.resume', () => {
    stats.resumes += 1;
  });
  client.on('voice.error', (msg: { code: string }) => {
    stats.errors.set(msg.code, (stats.errors.get(msg.code) ?? 0) + 1);
  });

  let seq = 0;
  const intervalMs = 1000 / FRAMES_PER_SECOND;
  await new Promise<void>((resolve) => {
    const handle = setInterval(() => {
      if (Date.now() >= deadline || !client.connected) {
        clearInterval(handle);
        resolve();
        return;
      }
      try {
        const env = encryptFrame(ctx, seq, synthetic);
        sentAt.set(seq, performance.now());
        client.emit('voice.frame', env);
        stats.framesSent += 1;
        seq += 1;
      } catch (err) {
        stats.errors.set('SEND_FAILED', (stats.errors.get('SEND_FAILED') ?? 0) + 1);
        // eslint-disable-next-line no-console
        console.error('encrypt/emit failed', err);
        clearInterval(handle);
        resolve();
      }
    }, intervalMs);
  });

  // Allow ~500 ms for in-flight acks before disconnecting.
  await new Promise((r) => setTimeout(r, 500));
  client.disconnect();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] * 100) / 100;
}

function aggregate(perVu: VuStats[]): Summary {
  const all: VuStats = newStats();
  for (const s of perVu) {
    all.framesSent += s.framesSent;
    all.acksReceived += s.acksReceived;
    all.pauses += s.pauses;
    all.resumes += s.resumes;
    for (const [code, n] of s.errors) {
      all.errors.set(code, (all.errors.get(code) ?? 0) + n);
    }
    all.latencies.push(...s.latencies);
  }
  all.latencies.sort((a, b) => a - b);
  return {
    vus: VUS,
    duration_s: DURATION_S,
    frames_per_second: FRAMES_PER_SECOND,
    frames_sent: all.framesSent,
    acks_received: all.acksReceived,
    ack_ratio: all.framesSent === 0 ? 0 : all.acksReceived / all.framesSent,
    pauses: all.pauses,
    resumes: all.resumes,
    errors_by_code: Object.fromEntries(all.errors),
    p50_ack_ms: percentile(all.latencies, 50),
    p95_ack_ms: percentile(all.latencies, 95),
    p99_ack_ms: percentile(all.latencies, 99),
  };
}

function writeSummary(s: Summary): void {
  writeFileSync(SUMMARY_PATH, JSON.stringify(s, null, 2));
  // eslint-disable-next-line no-console
  console.log(
    `[load] vus=${s.vus} sent=${s.frames_sent} acks=${s.acks_received} ` +
      `ratio=${s.ack_ratio.toFixed(3)} pauses=${s.pauses} resumes=${s.resumes} ` +
      `p50=${s.p50_ack_ms}ms p95=${s.p95_ack_ms}ms p99=${s.p99_ack_ms}ms ` +
      `errors=${JSON.stringify(s.errors_by_code)}`,
  );
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[load] starting vus=${VUS} duration=${DURATION_S}s fps=${FRAMES_PER_SECOND} url=${STREAM_SERVER_URL}`,
  );
  const redis = new Redis(REDIS_URL, { lazyConnect: false });
  const perVu: VuStats[] = Array.from({ length: VUS }, () => newStats());
  const deadline = Date.now() + DURATION_S * 1000;

  let interrupted = false;
  const onSignal = (): void => {
    interrupted = true;
    const partial = aggregate(perVu);
    writeSummary(partial);
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const results = await Promise.allSettled(
    perVu.map((stats) => runVu(redis, deadline, stats)),
  );
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      const stats = perVu[i];
      const code = (r.reason as Error)?.message ?? 'VU_FAILED';
      stats.errors.set(`VU:${code.slice(0, 40)}`, (stats.errors.get(`VU:${code.slice(0, 40)}`) ?? 0) + 1);
    }
  }

  await redis.quit().catch(() => undefined);

  if (interrupted) return;

  const summary = aggregate(perVu);
  writeSummary(summary);

  const fatal: string[] = [];
  if (summary.ack_ratio < 0.95) fatal.push(`ack_ratio ${summary.ack_ratio.toFixed(3)} < 0.95`);
  if ((summary.errors_by_code.DECRYPT_FAILED ?? 0) > 0) fatal.push('DECRYPT_FAILED > 0');
  if ((summary.errors_by_code.AUTH_FAILED ?? 0) > 0) fatal.push('AUTH_FAILED > 0');

  if (fatal.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[load] FAIL:', fatal.join('; '));
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[load] fatal', err);
  process.exit(1);
});
