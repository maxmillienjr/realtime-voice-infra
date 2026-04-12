export const SAMPLE_RATE_HZ = 16_000;
export const FRAME_DURATION_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE_HZ * FRAME_DURATION_MS) / 1000; // 320

export const IV_LENGTH_BYTES = 12;
export const GCM_TAG_LENGTH_BYTES = 16;
export const SEQ_LENGTH_BYTES = 4;
export const FRAME_HEADER_LENGTH_BYTES = SEQ_LENGTH_BYTES + IV_LENGTH_BYTES;

export const HKDF_INFO = 'voice-frame-v1';
export const SEQUENCE_MAX = 0xffffffff;

export const DEFAULT_BACKPRESSURE_THRESHOLD_BYTES = 256 * 1024;
export const DEFAULT_BACKPRESSURE_RESUME_BYTES = 64 * 1024;

export const VOICE_NAMESPACE = '/voice';
