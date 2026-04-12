import { FRAME_SAMPLES } from '@realtime-voice-infra/shared-types';

/**
 * Lock-free single-producer/single-consumer ring buffer backed by
 * SharedArrayBuffer. Producer is the AudioWorkletProcessor; consumer is
 * the main thread via requestAnimationFrame.
 *
 * Layout:
 *   cursors: Int32Array(2) → [writeIdx, readIdx]
 *   storage: Float32Array(capacity * FRAME_SAMPLES)
 */
export class FrameRingBuffer {
  static readonly CAPACITY = 4;

  readonly cursors: Int32Array;
  readonly storage: Float32Array;

  constructor(
    readonly cursorsSab: SharedArrayBuffer,
    readonly storageSab: SharedArrayBuffer,
  ) {
    this.cursors = new Int32Array(cursorsSab);
    this.storage = new Float32Array(storageSab);
  }

  static create(): FrameRingBuffer {
    const cursorsSab = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
    const storageSab = new SharedArrayBuffer(
      FrameRingBuffer.CAPACITY * FRAME_SAMPLES * Float32Array.BYTES_PER_ELEMENT,
    );
    return new FrameRingBuffer(cursorsSab, storageSab);
  }

  get framesAvailable(): number {
    const w = Atomics.load(this.cursors, 0);
    const r = Atomics.load(this.cursors, 1);
    return w - r;
  }

  read(): Float32Array | null {
    const w = Atomics.load(this.cursors, 0);
    const r = Atomics.load(this.cursors, 1);
    if (w === r) return null;
    const slot = r % FrameRingBuffer.CAPACITY;
    const out = this.storage.slice(
      slot * FRAME_SAMPLES,
      slot * FRAME_SAMPLES + FRAME_SAMPLES,
    );
    Atomics.store(this.cursors, 1, r + 1);
    return out;
  }
}
