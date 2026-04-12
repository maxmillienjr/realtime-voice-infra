import {
  FRAME_SAMPLES,
  SAMPLE_RATE_HZ,
} from '@realtime-voice-infra/shared-types';

export const SUPPORTED_FRAME_SAMPLES = [160, 320, 480] as const;
export type SupportedFrameSamples = (typeof SUPPORTED_FRAME_SAMPLES)[number];

export interface CodecOptions {
  sampleRate?: number;
  /** Frame length in samples. Opus supports 10/20/30 ms at 16 kHz. */
  frameSamples?: SupportedFrameSamples;
}

function assertSupportedFrame(samples: number): asserts samples is SupportedFrameSamples {
  if (!SUPPORTED_FRAME_SAMPLES.includes(samples as SupportedFrameSamples)) {
    throw new RangeError(
      `unsupported frame size ${samples}; expected one of ${SUPPORTED_FRAME_SAMPLES.join(', ')}`,
    );
  }
}

/**
 * TODO(libopus): replace the pass-through implementation below with a WASM
 * libopus binding (e.g. `libopusjs` or a custom Emscripten build). The wire
 * protocol, frame sizes, and callsites do not need to change — the WASM
 * encoder must accept Float32 PCM and produce a Uint8Array opus payload
 * that the decoder symmetrically reverses. The pass-through is in place so
 * that tests and integration wiring can exercise the full pipeline without
 * pulling a ~200 KB WASM blob into this commit.
 */

function floatToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0;
    const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function int16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

export class OpusEncoder {
  readonly sampleRate: number;
  readonly frameSamples: SupportedFrameSamples;

  constructor(options: CodecOptions = {}) {
    this.sampleRate = options.sampleRate ?? SAMPLE_RATE_HZ;
    this.frameSamples = options.frameSamples ?? (FRAME_SAMPLES as SupportedFrameSamples);
    assertSupportedFrame(this.frameSamples);
  }

  encode(pcm: Float32Array): Uint8Array {
    if (pcm.length !== this.frameSamples) {
      throw new RangeError(
        `encoder expected ${this.frameSamples} samples, got ${pcm.length}`,
      );
    }
    const pcm16 = floatToInt16(pcm);
    // Pass-through envelope (see TODO(libopus) above).
    return new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  }
}

export class OpusDecoder {
  readonly sampleRate: number;
  readonly frameSamples: SupportedFrameSamples;

  constructor(options: CodecOptions = {}) {
    this.sampleRate = options.sampleRate ?? SAMPLE_RATE_HZ;
    this.frameSamples = options.frameSamples ?? (FRAME_SAMPLES as SupportedFrameSamples);
    assertSupportedFrame(this.frameSamples);
  }

  decode(payload: Uint8Array): Float32Array {
    if (payload.byteLength !== this.frameSamples * 2) {
      throw new RangeError(
        `decoder expected ${this.frameSamples * 2} bytes, got ${payload.byteLength}`,
      );
    }
    const copy = new Uint8Array(payload);
    const pcm16 = new Int16Array(copy.buffer, copy.byteOffset, this.frameSamples);
    return int16ToFloat(pcm16);
  }
}
