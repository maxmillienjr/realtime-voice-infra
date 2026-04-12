import { Server as SocketIOServer } from 'socket.io';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';
import { rootLogger } from './logger.js';
import { installAuthMiddleware } from './middleware/auth.js';
import { attachSessionRouter } from './session-router.js';
import { InMemorySessionStore, type SessionStore } from './session-store.js';
import { RedisSessionStore } from './session-store.redis.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store: SessionStore = config.redisUrl
    ? RedisSessionStore.connect(config.redisUrl)
    : new InMemorySessionStore();

  let activeSessions = 0;
  const http = buildHttpApp(config, store, () => activeSessions);
  await http.listen({ port: config.port, host: config.host });
  rootLogger.info({ port: config.port, host: config.host }, 'http listening');

  const io = new SocketIOServer(http.server, {
    serveClient: false,
    maxHttpBufferSize: 1e6,
    cors: { origin: true, credentials: true },
  });
  installAuthMiddleware(io, config, store);
  attachSessionRouter(io, store, config);

  io.of('/voice').on('connection', (socket) => {
    activeSessions += 1;
    socket.on('disconnect', () => {
      activeSessions -= 1;
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    rootLogger.info({ signal }, 'shutdown requested');
    io.of('/voice').emit('voice.control', { type: 'stop' });
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, config.shutdownGraceMs);
      io.close(() => {
        clearTimeout(t);
        resolve();
      });
    });
    await http.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  rootLogger.error({ err: String(err) }, 'fatal');
  process.exit(1);
});
