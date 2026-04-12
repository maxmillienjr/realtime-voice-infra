export interface BackpressureOptions {
  thresholdBytes: number;
  resumeBytes: number;
}

export type BackpressureEvent =
  | { type: 'pause'; bufferBytes: number; thresholdBytes: number }
  | { type: 'resume'; bufferBytes: number };

/**
 * Tracks per-session in-flight bytes and emits pause/resume transitions.
 *
 * Why: unbounded ingest queue growth is the #1 OOM mode for voice infra
 * under load. The pause threshold is chosen so the ring buffer on the
 * client can absorb the in-flight frames without drop.
 */
export class BackpressureTracker {
  private pending = 0;
  private paused = false;

  constructor(private readonly opts: BackpressureOptions) {}

  get bufferBytes(): number {
    return this.pending;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  add(bytes: number): BackpressureEvent | null {
    this.pending += bytes;
    if (!this.paused && this.pending > this.opts.thresholdBytes) {
      this.paused = true;
      return {
        type: 'pause',
        bufferBytes: this.pending,
        thresholdBytes: this.opts.thresholdBytes,
      };
    }
    return null;
  }

  release(bytes: number): BackpressureEvent | null {
    this.pending = Math.max(0, this.pending - bytes);
    if (this.paused && this.pending < this.opts.resumeBytes) {
      this.paused = false;
      return { type: 'resume', bufferBytes: this.pending };
    }
    return null;
  }
}
