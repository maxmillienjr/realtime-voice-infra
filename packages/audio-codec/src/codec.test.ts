import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES, SAMPLE_RATE_HZ } from '@realtime-voice-infra/shared-types';
import { OpusDecoder, OpusEncoder } from './codec.js';

function sineFrame(freqHz: number, samples: number, rate = SAMPLE_RATE_HZ): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / rate) * 0.5;
  }
  return out;
}

describe('OpusEncoder/Decoder', () => {
  it('round-trips a 440 Hz sine at 20 ms with RMSE < 0.05', () => {
    const enc = new OpusEncoder();
    const dec = new OpusDecoder();
    const pcm = sineFrame(440, FRAME_SAMPLES);
    const bytes = enc.encode(pcm);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const out = dec.decode(bytes);
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      const orig = pcm[i] ?? 0;
      const recon = out[i] ?? 0;
      const d = orig - recon;
      sumSq += d * d;
    }
    const rmse = Math.sqrt(sumSq / pcm.length);
    expect(rmse).toBeLessThan(0.05);
  });

  it('rejects wrong-sized input', () => {
    const enc = new OpusEncoder();
    expect(() => enc.encode(new Float32Array(100))).toThrow();
  });

  it('supports 10ms (160) and 30ms (480) frame sizes', () => {
    for (const size of [160, 480] as const) {
      const enc = new OpusEncoder({ frameSamples: size });
      const dec = new OpusDecoder({ frameSamples: size });
      const frame = sineFrame(440, size);
      const out = dec.decode(enc.encode(frame));
      expect(out.length).toBe(size);
    }
  });

  it('rejects unsupported frame size at construction', () => {
    expect(() => new OpusEncoder({ frameSamples: 200 as never })).toThrow();
  });
});
