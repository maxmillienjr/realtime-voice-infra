import { createCipheriv, createDecipheriv } from 'node:crypto';
import {
  FRAME_HEADER_LENGTH_BYTES,
  GCM_TAG_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  SEQ_LENGTH_BYTES,
} from '@realtime-voice-infra/shared-types';
import { DecryptFailedError } from './errors.js';
import { buildIV, sessionFingerprint } from './iv.js';

export interface SessionCryptoContext {
  readonly sessionId: string;
  readonly frameKey: Buffer;
  readonly fingerprint: Buffer;
}

export function createSessionCrypto(
  sessionId: string,
  frameKey: Buffer,
): SessionCryptoContext {
  return {
    sessionId,
    frameKey,
    fingerprint: sessionFingerprint(sessionId),
  };
}

/**
 * Wire format: [seq 4B BE][iv 12B][ciphertext...][tag 16B]
 */
export function encryptFrame(
  ctx: SessionCryptoContext,
  sequence: number,
  plaintext: Uint8Array,
): Buffer {
  const iv = buildIV(sequence, ctx.fingerprint);
  const cipher = createCipheriv('aes-256-gcm', ctx.frameKey, iv, {
    authTagLength: GCM_TAG_LENGTH_BYTES,
  });
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const seqBuf = Buffer.alloc(SEQ_LENGTH_BYTES);
  seqBuf.writeUInt32BE(sequence, 0);
  return Buffer.concat([seqBuf, iv, ct, tag]);
}

export interface DecryptedFrame {
  sequence: number;
  plaintext: Buffer;
}

export function decryptFrame(
  ctx: SessionCryptoContext,
  envelope: Buffer,
): DecryptedFrame {
  if (envelope.length < FRAME_HEADER_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES) {
    throw new DecryptFailedError('frame envelope truncated');
  }
  const sequence = envelope.readUInt32BE(0);
  const iv = envelope.subarray(
    SEQ_LENGTH_BYTES,
    SEQ_LENGTH_BYTES + IV_LENGTH_BYTES,
  );
  const tagStart = envelope.length - GCM_TAG_LENGTH_BYTES;
  const ciphertext = envelope.subarray(FRAME_HEADER_LENGTH_BYTES, tagStart);
  const tag = envelope.subarray(tagStart);

  // Detect IV tampering: bytes 0..3 of IV must equal the declared sequence.
  if (iv.readUInt32BE(0) !== sequence) {
    throw new DecryptFailedError('iv/sequence mismatch');
  }

  const decipher = createDecipheriv('aes-256-gcm', ctx.frameKey, iv, {
    authTagLength: GCM_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return { sequence, plaintext };
  } catch (err) {
    throw new DecryptFailedError(
      err instanceof Error ? err.message : 'decrypt error',
    );
  }
}
