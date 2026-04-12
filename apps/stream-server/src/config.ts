import {
  DEFAULT_BACKPRESSURE_RESUME_BYTES,
  DEFAULT_BACKPRESSURE_THRESHOLD_BYTES,
} from '@realtime-voice-infra/shared-types';

function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be numeric`);
  return n;
}

function envString(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export interface Config {
  port: number;
  host: string;
  jwtSecret: Uint8Array;
  backpressureThresholdBytes: number;
  backpressureResumeBytes: number;
  shutdownGraceMs: number;
  redisUrl: string | null;
  logLevel: string;
}

export function loadConfig(): Config {
  const secret = envString(
    'JWT_SECRET',
    'dev-only-insecure-secret-change-me-please-32b',
  );
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes');
  }
  const redisUrl = process.env.REDIS_URL ?? null;
  return {
    port: envNumber('PORT', 3000),
    host: envString('HOST', '0.0.0.0'),
    jwtSecret: new TextEncoder().encode(secret),
    backpressureThresholdBytes: envNumber(
      'BACKPRESSURE_THRESHOLD',
      DEFAULT_BACKPRESSURE_THRESHOLD_BYTES,
    ),
    backpressureResumeBytes: envNumber(
      'BACKPRESSURE_RESUME',
      DEFAULT_BACKPRESSURE_RESUME_BYTES,
    ),
    shutdownGraceMs: envNumber('SHUTDOWN_GRACE_MS', 10_000),
    redisUrl: redisUrl && redisUrl.length > 0 ? redisUrl : null,
    logLevel: envString('LOG_LEVEL', 'info'),
  };
}
