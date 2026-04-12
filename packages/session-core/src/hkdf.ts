import { hkdfSync, randomBytes } from 'node:crypto';
import { HKDF_INFO } from '@realtime-voice-infra/shared-types';

export function generateSessionKey(): Buffer {
  return randomBytes(32);
}

/**
 * Derive a single per-session frame key from the session master key.
 * Per-frame IVs provide nonce uniqueness; per-frame HKDF would be pure overhead.
 */
export function deriveFrameKey(sessionKey: Buffer, sessionId: string): Buffer {
  const salt = Buffer.from(sessionId, 'utf8');
  const info = Buffer.from(HKDF_INFO, 'utf8');
  const out = hkdfSync('sha256', sessionKey, salt, info, 32);
  return Buffer.from(out);
}
