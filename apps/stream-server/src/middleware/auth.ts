import type { Server, Socket } from 'socket.io';
import {
  type SessionStore,
} from '../session-store.js';
import { verifySessionJWT } from '@realtime-voice-infra/session-core';
import { VOICE_NAMESPACE } from '@realtime-voice-infra/shared-types';
import type { Config } from '../config.js';
import { rootLogger } from '../logger.js';

export function installAuthMiddleware(
  io: Server,
  config: Config,
  store: SessionStore,
): void {
  io.of(VOICE_NAMESPACE).use(async (socket: Socket, next) => {
    try {
      const header =
        (socket.handshake.auth?.token as string | undefined) ??
        extractBearer(socket.handshake.headers['authorization']);
      if (!header) return next(new Error('AUTH_FAILED: missing token'));

      const claims = await verifySessionJWT(header, config.jwtSecret, store);
      const session = await store.getSession(claims.sub);
      if (!session) return next(new Error('AUTH_FAILED: session not found'));

      socket.data.sessionId = claims.sub;
      next();
    } catch (err) {
      rootLogger.warn({ err: String(err) }, 'socket auth rejected');
      const e = new Error('AUTH_FAILED');
      (e as Error & { data?: unknown }).data = { code: 4001 };
      next(e);
    }
  });
}

function extractBearer(header: string | string[] | undefined): string | undefined {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(h);
  return match?.[1];
}
