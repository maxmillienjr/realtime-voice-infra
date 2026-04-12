// AudioWorkletProcessor that accumulates 128-sample blocks into 320-sample
// (20 ms @ 16 kHz) frames and writes them to the shared ring buffer.
//
// Contract with the main thread: cursors[0]=write idx, cursors[1]=read
// idx; storage holds CAPACITY*FRAME_SAMPLES Float32 samples in slot-major
// layout. Overrun (write catching up to read) drops the oldest slot —
// backpressure is the main thread's job, not the worklet's.
const FRAME_SAMPLES = 320;
const CAPACITY = 4;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { cursorsSab, storageSab } = options.processorOptions;
    this.cursors = new Int32Array(cursorsSab);
    this.storage = new Float32Array(storageSab);
    this.acc = new Float32Array(FRAME_SAMPLES);
    this.accFill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this.acc[this.accFill++] = channel[i];
      if (this.accFill === FRAME_SAMPLES) {
        this.flush();
        this.accFill = 0;
      }
    }
    return true;
  }

  flush() {
    const w = Atomics.load(this.cursors, 0);
    const r = Atomics.load(this.cursors, 1);
    // Drop oldest if full — main thread will catch up.
    if (w - r >= CAPACITY) {
      Atomics.store(this.cursors, 1, r + 1);
    }
    const slot = w % CAPACITY;
    this.storage.set(this.acc, slot * FRAME_SAMPLES);
    Atomics.store(this.cursors, 0, w + 1);
  }
}

registerProcessor('capture-processor', CaptureProcessor);
