import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server as SocketIOServer } from 'socket.io';
import { io as clientIO, type Socket as ClientSocket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  createSessionCrypto,
  deriveFrameKey,
  encryptFrame,
  generateSessionKey,
  signSessionJWT,
} from '@realtime-voice-infra/session-core';
import { VOICE_NAMESPACE } from '@realtime-voice-infra/shared-types';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';
import { installAuthMiddleware } from './middleware/auth.js';
import { attachSessionRouter } from './session-router.js';
import { InMemorySessionStore } from './session-store.js';

describe('stream-server integration', () => {
  let url: string;
  let teardown: () => Promise<void>;
  let store: InMemorySessionStore;
  let jwtSecret: Uint8Array;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-bytes-long-aaaaaaa';
    process.env.PORT = '0';
    const config = loadConfig();
    jwtSecret = config.jwtSecret;
    store = new InMemorySessionStore();

    const app = buildHttpApp(config, store, () => 0);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;

    const io = new SocketIOServer(app.server, { serveClient: false });
    installAuthMiddleware(io, config, store);
    attachSessionRouter(io, store, config);

    teardown = async () => {
      io.close();
      await app.close();
    };
  });

  afterAll(async () => {
    await teardown();
  });

  async function setupSession(): Promise<{
    client: ClientSocket;
    sessionId: string;
    ctx: ReturnType<typeof createSessionCrypto>;
  }> {
    const sessionId = randomUUID();
    const key = generateSessionKey();
    await store.putSession(sessionId, key, 600);
    const token = await signSessionJWT(sessionId, jwtSecret);
    const client = clientIO(`${url}${VOICE_NAMESPACE}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((res, rej) => {
      client.once('connect', () => res());
      client.once('connect_error', rej);
    });
    const frameKey = deriveFrameKey(key, sessionId);
    return { client, sessionId, ctx: createSessionCrypto(sessionId, frameKey) };
  }

  it('acks a valid encrypted frame', async () => {
    const { client, ctx } = await setupSession();
    const ack = new Promise<{ sequence: number }>((resolve) => {
      client.once('voice.ack', (m: { sequence: number }) => resolve(m));
    });
    const env = encryptFrame(ctx, 0, Buffer.from('pcm-bytes'));
    client.emit('voice.frame', env);
    const got = await ack;
    expect(got.sequence).toBe(0);
    client.disconnect();
  });

  it('emits SEQUENCE_GAP when sequence skips', async () => {
    const { client, ctx } = await setupSession();
    const err = new Promise<{ code: string }>((resolve) => {
      client.once('voice.error', (m: { code: string }) => resolve(m));
    });
    const env = encryptFrame(ctx, 5, Buffer.from('x'));
    client.emit('voice.frame', env);
    const got = await err;
    expect(got.code).toBe('SEQUENCE_GAP');
    client.disconnect();
  });

  it('emits DECRYPT_FAILED when GCM tag is tampered', async () => {
    const { client, ctx } = await setupSession();
    const err = new Promise<{ code: string }>((resolve) => {
      client.once('voice.error', (m: { code: string }) => resolve(m));
    });
    const env = encryptFrame(ctx, 0, Buffer.from('x'));
    env[env.length - 1] ^= 0x01;
    client.emit('voice.frame', env);
    const got = await err;
    expect(got.code).toBe('DECRYPT_FAILED');
    client.disconnect();
  });

  it('rejects connect with missing token', async () => {
    const client = clientIO(`${url}${VOICE_NAMESPACE}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    const rejected = await new Promise<boolean>((resolve) => {
      client.once('connect', () => resolve(false));
      client.once('connect_error', () => resolve(true));
    });
    expect(rejected).toBe(true);
    client.disconnect();
  });
});
