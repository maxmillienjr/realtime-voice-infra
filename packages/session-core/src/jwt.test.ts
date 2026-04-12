import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  InMemoryJtiStore,
  signSessionJWT,
  verifySessionJWT,
} from './jwt.js';
import { JWTReplayError } from './errors.js';

const secret = new TextEncoder().encode(
  'test-secret-at-least-32-bytes-long-aaaaaaa',
);

describe('JWT sign/verify', () => {
  it('round-trips a valid token', async () => {
    const sid = randomUUID();
    const token = await signSessionJWT(sid, secret);
    const store = new InMemoryJtiStore();
    const claims = await verifySessionJWT(token, secret, store);
    expect(claims.sub).toBe(sid);
    expect(claims.scope).toBe('voice:stream');
  });

  it('rejects replayed jti', async () => {
    const token = await signSessionJWT(randomUUID(), secret);
    const store = new InMemoryJtiStore();
    await verifySessionJWT(token, secret, store);
    await expect(verifySessionJWT(token, secret, store)).rejects.toBeInstanceOf(
      JWTReplayError,
    );
  });

  it('rejects expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 10_000;
    const token = await signSessionJWT(randomUUID(), secret, past);
    const store = new InMemoryJtiStore();
    await expect(verifySessionJWT(token, secret, store)).rejects.toThrow();
  });

  it('rejects token signed with different secret', async () => {
    const token = await signSessionJWT(randomUUID(), secret);
    const other = new TextEncoder().encode(
      'other-secret-at-least-32-bytes-long-xxxxx',
    );
    const store = new InMemoryJtiStore();
    await expect(verifySessionJWT(token, other, store)).rejects.toThrow();
  });
});
