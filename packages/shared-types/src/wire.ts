import { z } from 'zod';

export const VoiceControlSchema = z.object({
  type: z.enum(['start', 'stop', 'flush']),
  session_id: z.string().uuid(),
});
export type VoiceControl = z.infer<typeof VoiceControlSchema>;

export const VoiceErrorCodeSchema = z.enum([
  'AUTH_FAILED',
  'SEQUENCE_GAP',
  'DECRYPT_FAILED',
  'BUFFER_OVERFLOW',
  'VALIDATION_FAILED',
  'SEQUENCE_EXHAUSTED',
]);
export type VoiceErrorCode = z.infer<typeof VoiceErrorCodeSchema>;

export const VoiceErrorSchema = z.object({
  code: VoiceErrorCodeSchema,
  message: z.string(),
  sequence: z.number().int().nonnegative().optional(),
});
export type VoiceError = z.infer<typeof VoiceErrorSchema>;

export const VoiceAckSchema = z.object({
  sequence: z.number().int().nonnegative(),
  received_at: z.number().int().nonnegative(),
});
export type VoiceAck = z.infer<typeof VoiceAckSchema>;

export const VoicePauseSchema = z.object({
  buffer_bytes: z.number().int().nonnegative(),
  threshold_bytes: z.number().int().nonnegative(),
});
export type VoicePause = z.infer<typeof VoicePauseSchema>;

export const VoiceResumeSchema = z.object({
  buffer_bytes: z.number().int().nonnegative(),
});
export type VoiceResume = z.infer<typeof VoiceResumeSchema>;

export const SessionInitRequestSchema = z.object({
  client_pubkey_b64: z.string().optional(),
});
export type SessionInitRequest = z.infer<typeof SessionInitRequestSchema>;

export const SessionInitResponseSchema = z.object({
  jwt: z.string(),
  session_id: z.string().uuid(),
});
export type SessionInitResponse = z.infer<typeof SessionInitResponseSchema>;
