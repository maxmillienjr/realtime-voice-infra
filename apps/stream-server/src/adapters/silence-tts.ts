// STUB IMPLEMENTATION — emits 50 frames (1 s) of silence for any input.
// Swap for ElevenLabs streaming: yield PCM Float32Array[320] chunks as
// they arrive from the synthesis websocket.
import { FRAME_SAMPLES } from '@realtime-voice-infra/shared-types';
import type { TTSAdapter } from '@realtime-voice-infra/shared-types';

export class SilenceTTS implements TTSAdapter {
  async *synthesize(
    _sessionId: string,
    _text: string,
  ): AsyncIterable<Float32Array> {
    for (let i = 0; i < 50; i++) {
      yield new Float32Array(FRAME_SAMPLES);
    }
  }
}
