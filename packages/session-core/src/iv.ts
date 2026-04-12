import { createHash } from 'node:crypto';
import {
  IV_LENGTH_BYTES,
  SEQUENCE_MAX,
} from '@realtime-voice-infra/shared-types';
import { SequenceExhaustedError } from './errors.js';

export function sessionFingerprint(sessionId: string): Buffer {
  return createHash('sha256').update(sessionId, 'utf8').digest().subarray(0, 8);
}

/**
 * IV layout (12 bytes):
 *   [0..3]  uint32 BE sequence
 *   [4..11] first 8 bytes of SHA-256(session_id)
 */
export function buildIV(sequence: number, fingerprint: Buffer): Buffer {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > SEQUENCE_MAX) {
    throw new RangeError(`sequence out of uint32 range: ${sequence}`);
  }
  if (sequence === SEQUENCE_MAX) {
    throw new SequenceExhaustedError();
  }
  if (fingerprint.length !== 8) {
    throw new RangeError('fingerprint must be 8 bytes');
  }
  const iv = Buffer.alloc(IV_LENGTH_BYTES);
  iv.writeUInt32BE(sequence, 0);
  fingerprint.copy(iv, 4);
  return iv;
}
