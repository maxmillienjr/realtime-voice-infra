import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createSessionCrypto,
  decryptFrame,
  encryptFrame,
} from './crypto.js';
import { deriveFrameKey, generateSessionKey } from './hkdf.js';
import { buildIV, sessionFingerprint } from './iv.js';
import { SequenceExhaustedError } from './errors.js';
import { SEQUENCE_MAX } from '@realtime-voice-infra/shared-types';

function makeCtx() {
  const sessionId = randomUUID();
  const master = generateSessionKey();
  const frameKey = deriveFrameKey(master, sessionId);
  return createSessionCrypto(sessionId, frameKey);
}

describe('encrypt/decrypt round-trip', () => {
  it('decrypts to original plaintext', () => {
    const ctx = makeCtx();
    const pt = Buffer.from('hello opus frame');
    const env = encryptFrame(ctx, 42, pt);
    const dec = decryptFrame(ctx, env);
    expect(dec.sequence).toBe(42);
    expect(dec.plaintext.equals(pt)).toBe(true);
  });

  it('fails authentication when tag is tampered', () => {
    const ctx = makeCtx();
    const env = encryptFrame(ctx, 1, Buffer.from('payload'));
    env[env.length - 1] ^= 0x01;
    expect(() => decryptFrame(ctx, env)).toThrow();
  });

  it('fails when cross-session key is used', () => {
    const ctxA = makeCtx();
    const ctxB = makeCtx();
    const env = encryptFrame(ctxA, 7, Buffer.from('x'));
    expect(() => decryptFrame(ctxB, env)).toThrow();
  });
});

describe('IV construction', () => {
  it('produces 1000 distinct IVs for consecutive sequences', () => {
    const fp = sessionFingerprint(randomUUID());
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(buildIV(i, fp).toString('hex'));
    }
    expect(seen.size).toBe(1000);
  });

  it('rejects sequence === SEQUENCE_MAX with SequenceExhaustedError', () => {
    const fp = sessionFingerprint(randomUUID());
    expect(() => buildIV(SEQUENCE_MAX, fp)).toThrow(SequenceExhaustedError);
  });

  it('accepts SEQUENCE_MAX - 1 but not SEQUENCE_MAX (AC-5)', () => {
    const fp = sessionFingerprint(randomUUID());
    expect(() => buildIV(SEQUENCE_MAX - 1, fp)).not.toThrow();
    expect(() => buildIV(SEQUENCE_MAX, fp)).toThrow(SequenceExhaustedError);
  });
});

describe('HKDF determinism', () => {
  it('same inputs → same frame_key', () => {
    const sid = randomUUID();
    const master = generateSessionKey();
    const a = deriveFrameKey(master, sid);
    const b = deriveFrameKey(master, sid);
    expect(a.equals(b)).toBe(true);
  });

  it('different session_id → different frame_key', () => {
    const master = generateSessionKey();
    const a = deriveFrameKey(master, randomUUID());
    const b = deriveFrameKey(master, randomUUID());
    expect(a.equals(b)).toBe(false);
  });
});
