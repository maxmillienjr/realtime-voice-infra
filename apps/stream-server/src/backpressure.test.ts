import { describe, expect, it } from 'vitest';
import { BackpressureTracker } from './backpressure.js';

describe('BackpressureTracker', () => {
  const opts = { thresholdBytes: 1000, resumeBytes: 200 };

  it('emits pause when crossing threshold', () => {
    const bp = new BackpressureTracker(opts);
    expect(bp.add(500)).toBeNull();
    const ev = bp.add(600);
    expect(ev?.type).toBe('pause');
    expect(bp.isPaused).toBe(true);
  });

  it('does not double-emit pause', () => {
    const bp = new BackpressureTracker(opts);
    bp.add(1500);
    expect(bp.add(100)).toBeNull();
  });

  it('emits resume when falling below resume threshold', () => {
    const bp = new BackpressureTracker(opts);
    bp.add(1500);
    expect(bp.release(1000)).toBeNull();
    const ev = bp.release(400);
    expect(ev?.type).toBe('resume');
    expect(bp.isPaused).toBe(false);
  });

  it('has hysteresis: pending in [resume, threshold] stays paused', () => {
    const bp = new BackpressureTracker(opts);
    bp.add(1500);
    bp.release(500); // pending=1000, still paused
    expect(bp.isPaused).toBe(true);
  });
});
