export const JWT_ISSUER = 'realtime-voice-infra';
export const JWT_SCOPE = 'voice:stream';
export const JWT_TTL_SECONDS = 300;

export interface SessionJWTClaims {
  iss: typeof JWT_ISSUER;
  sub: string; // session_id
  iat: number;
  exp: number;
  jti: string;
  scope: typeof JWT_SCOPE;
}
