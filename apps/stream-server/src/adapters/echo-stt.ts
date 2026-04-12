// STUB IMPLEMENTATION — returns a fake partial transcript every 10 frames.
// Swap for @deepgram/sdk LiveClient: stream decrypted PCM to its websocket
// and map `transcript` events to onTranscript().
import type { STTAdapter } from '@realtime-voice-infra/shared-types';

type TranscriptHandler = (text: string, isFinal: boolean) => void;

export class EchoSTT implements STTAdapter {
  private readonly counters = new Map<string, number>();
  private readonly handlers = new Map<string, TranscriptHandler>();

  pushFrame(sessionId: string, _pcm: Float32Array): void {
    const n = (this.counters.get(sessionId) ?? 0) + 1;
    this.counters.set(sessionId, n);
    if (n % 10 === 0) {
      this.handlers.get(sessionId)?.(`[frame ${n} received]`, false);
    }
  }

  onTranscript(sessionId: string, handler: TranscriptHandler): void {
    this.handlers.set(sessionId, handler);
  }

  async endSession(sessionId: string): Promise<void> {
    const n = this.counters.get(sessionId) ?? 0;
    this.handlers.get(sessionId)?.(`[final: ${n} frames]`, true);
    this.counters.delete(sessionId);
    this.handlers.delete(sessionId);
  }
}
