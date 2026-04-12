import { describe, expect, it } from 'vitest';
import { VoiceControlSchema } from './wire.js';

describe('VoiceControlSchema', () => {
  it('accepts valid start control', () => {
    const parsed = VoiceControlSchema.parse({
      type: 'start',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(parsed.type).toBe('start');
  });

  it('rejects non-UUID session_id', () => {
    expect(() =>
      VoiceControlSchema.parse({ type: 'stop', session_id: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects unknown control type', () => {
    expect(() =>
      VoiceControlSchema.parse({
        type: 'pause',
        session_id: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).toThrow();
  });
});
