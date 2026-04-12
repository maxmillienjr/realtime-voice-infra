import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import {
  JWT_ISSUER,
  JWT_SCOPE,
  JWT_TTL_SECONDS,
  type SessionJWTClaims,
} from '@realtime-voice-infra/shared-types';
import { JWTReplayError } from './errors.js';

export interface JtiStore {
  /** Returns true on first sight of this jti, false if already consumed. */
  consume(jti: string, exp: number): Promise<boolean>;
}

export class InMemoryJtiStore implements JtiStore {
  private readonly seen = new Map<string, number>();

  async consume(jti: string, exp: number): Promise<boolean> {
    this.sweep();
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, exp);
    return true;
  }

  private sweep(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.seen) {
      if (exp <= now) this.seen.delete(jti);
    }
  }
}

export async function signSessionJWT(
  sessionId: string,
  secret: Uint8Array,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const jti = randomUUID();
  return new SignJWT({ scope: JWT_SCOPE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setSubject(sessionId)
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_TTL_SECONDS)
    .setJti(jti)
    .sign(secret);
}

export async function verifySessionJWT(
  token: string,
  secret: Uint8Array,
  jtiStore: JtiStore,
): Promise<SessionJWTClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: JWT_ISSUER,
  });
  if (payload.scope !== JWT_SCOPE) {
    throw new Error(`unexpected scope: ${String(payload.scope)}`);
  }
  if (!payload.sub || !payload.jti || !payload.exp || !payload.iat) {
    throw new Error('malformed JWT claims');
  }
  const fresh = await jtiStore.consume(payload.jti, payload.exp);
  if (!fresh) throw new JWTReplayError();
  return {
    iss: JWT_ISSUER,
    sub: payload.sub,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
    scope: JWT_SCOPE,
  };
}
