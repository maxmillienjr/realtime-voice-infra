/**
 * Lightweight in-process counter shim. In production these would be OTel
 * instruments exported via OTLP; we keep an interface-compatible shim so
 * the session router can be instrumented today and the OTel bridge added
 * later without call-site changes.
 */
export interface Counter {
  add(n: number, attrs?: Record<string, string | number>): void;
}

class InMemoryCounter implements Counter {
  private total = 0;
  add(n: number): void {
    this.total += n;
  }
  get value(): number {
    return this.total;
  }
}

export const metrics = {
  framesReceived: new InMemoryCounter(),
  bytesReceived: new InMemoryCounter(),
  pauseEvents: new InMemoryCounter(),
  droppedFrames: new InMemoryCounter(),
};
