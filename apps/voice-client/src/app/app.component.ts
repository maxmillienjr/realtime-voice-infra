import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { io, type Socket } from 'socket.io-client';
import { FRAME_SAMPLES, VOICE_NAMESPACE } from '@realtime-voice-infra/shared-types';
import { OpusEncoder } from '@realtime-voice-infra/audio-codec';
import { FrameRingBuffer } from './ring-buffer.js';
import { SessionService } from './session.service.js';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>realtime-voice-infra</h1>
    <p class="status">status: {{ connectionStatus() }}</p>
    <p class="status">frames acked: {{ frameCounter() }}</p>
    <p class="status" *ngIf="backpressureActive()">⚠ backpressure active</p>
    <p class="error" *ngIf="fatalError()">error: {{ fatalError() }}</p>
    <button (click)="start()" [disabled]="connectionStatus() === 'connected'">Start</button>
    <button (click)="stop()" [disabled]="connectionStatus() !== 'connected'">Stop</button>
    <canvas #waveform width="480" height="80"></canvas>
  `,
})
export class AppComponent {
  private readonly sessionService = inject(SessionService);

  readonly connectionStatus = signal<ConnectionStatus>('disconnected');
  readonly frameCounter = signal(0);
  readonly backpressureActive = signal(false);
  readonly fatalError = signal<string | null>(null);
  readonly waveformData = signal<Float32Array>(new Float32Array(FRAME_SAMPLES));

  private socket: Socket | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private ringBuffer: FrameRingBuffer | null = null;
  private encoder: OpusEncoder | null = null;
  private sequence = 0;
  private rafHandle = 0;

  constructor() {
    effect(() => {
      // Placeholder for canvas render hook.
      void this.waveformData();
    });
  }

  async start(): Promise<void> {
    this.fatalError.set(null);
    this.connectionStatus.set('connecting');
    try {
      if (typeof SharedArrayBuffer === 'undefined') {
        throw new Error('SharedArrayBuffer not available (missing COOP/COEP headers)');
      }

      const { jwt } = await this.sessionService.init();
      this.socket = io(`http://localhost:3000${VOICE_NAMESPACE}`, {
        auth: { token: jwt },
        transports: ['websocket'],
      });
      this.bindSocket();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      await this.audioContext.audioWorklet.addModule('/worklets/capture-processor.js');

      this.ringBuffer = FrameRingBuffer.create();
      this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-processor', {
        processorOptions: {
          cursorsSab: this.ringBuffer.cursorsSab,
          storageSab: this.ringBuffer.storageSab,
        },
        outputChannelCount: [1],
      });
      this.audioContext.createMediaStreamSource(stream).connect(this.workletNode);

      this.encoder = new OpusEncoder();
      this.sequence = 0;
      this.rafHandle = requestAnimationFrame(this.consumeFrames);
    } catch (err) {
      this.fatalError.set(err instanceof Error ? err.message : String(err));
      this.connectionStatus.set('error');
    }
  }

  stop(): void {
    cancelAnimationFrame(this.rafHandle);
    this.workletNode?.disconnect();
    this.audioContext?.close();
    this.socket?.disconnect();
    this.socket = null;
    this.ringBuffer = null;
    this.connectionStatus.set('disconnected');
  }

  private bindSocket(): void {
    if (!this.socket) return;
    this.socket.on('connect', () => this.connectionStatus.set('connected'));
    this.socket.on('disconnect', () => this.connectionStatus.set('disconnected'));
    this.socket.on('connect_error', (err: Error) => {
      this.fatalError.set(err.message);
      this.connectionStatus.set('error');
    });
    this.socket.on('voice.ack', () => this.frameCounter.update((n) => n + 1));
    this.socket.on('voice.pause', () => this.backpressureActive.set(true));
    this.socket.on('voice.resume', () => this.backpressureActive.set(false));
    this.socket.on('voice.error', (err: { code: string; message: string }) => {
      this.fatalError.set(`${err.code}: ${err.message}`);
    });
  }

  private readonly consumeFrames = (): void => {
    if (!this.ringBuffer || !this.encoder || !this.socket) return;
    while (this.ringBuffer.framesAvailable > 0) {
      const pcm = this.ringBuffer.read();
      if (!pcm) break;
      if (this.backpressureActive()) break;
      const opus = this.encoder.encode(pcm);
      // NOTE: encryption happens here in production — pending a WebCrypto
      // client-side crypto helper that mirrors session-core. For now emit
      // unencrypted against a dev server configured accordingly.
      const envelope = this.buildEnvelope(this.sequence++, opus);
      this.socket.emit('voice.frame', envelope);
      this.waveformData.set(pcm);
    }
    this.rafHandle = requestAnimationFrame(this.consumeFrames);
  };

  private buildEnvelope(seq: number, payload: Uint8Array): ArrayBuffer {
    const out = new Uint8Array(4 + payload.byteLength);
    new DataView(out.buffer).setUint32(0, seq, false);
    out.set(payload, 4);
    return out.buffer;
  }
}
