import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  JWT_TTL_SECONDS,
  SessionInitRequestSchema,
  type SessionInitResponse,
} from '@realtime-voice-infra/shared-types';
import {
  generateSessionKey,
  signSessionJWT,
} from '@realtime-voice-infra/session-core';
import type { Config } from './config.js';
import type { SessionStore } from './session-store.js';

export function buildHttpApp(
  config: Config,
  store: SessionStore,
  getActiveSessionCount: () => number,
): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/healthz', async (_req, reply) => {
    reply.code(200).send({ status: 'ok' });
  });

  app.get('/readyz', async (_req, reply) => {
    const ok = await store.ping().catch(() => false);
    if (!ok) return reply.code(503).send({ status: 'redis unavailable' });
    reply.code(200).send({ active_sessions: getActiveSessionCount() });
  });

  app.post('/session/init', async (req, reply) => {
    const parsed = SessionInitRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const sessionId = randomUUID();
    const sessionKey = generateSessionKey();
    await store.putSession(sessionId, sessionKey, JWT_TTL_SECONDS + 60);
    const jwt = await signSessionJWT(sessionId, config.jwtSecret);
    const body: SessionInitResponse = { jwt, session_id: sessionId };
    reply.code(200).send(body);
  });

  return app;
}
