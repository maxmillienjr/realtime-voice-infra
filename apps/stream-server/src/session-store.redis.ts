import Redis from 'ioredis';
import type { SessionStore, StoredSession } from './session-store.js';

const SESSION_PREFIX = 'sess:';
const JTI_PREFIX = 'jti:';

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  static connect(url: string): RedisSessionStore {
    return new RedisSessionStore(new Redis(url, { lazyConnect: false }));
  }

  async putSession(sessionId: string, key: Buffer, ttlSeconds: number): Promise<void> {
    await this.redis.set(SESSION_PREFIX + sessionId, key.toString('base64'), 'EX', ttlSeconds);
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    const v = await this.redis.get(SESSION_PREFIX + sessionId);
    if (!v) return null;
    return { sessionKey: Buffer.from(v, 'base64'), createdAt: 0 };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(SESSION_PREFIX + sessionId);
  }

  async consume(jti: string, exp: number): Promise<boolean> {
    const ttl = Math.max(1, exp - Math.floor(Date.now() / 1000));
    // SET NX with TTL — atomic single-use nonce.
    const res = await this.redis.set(JTI_PREFIX + jti, '1', 'EX', ttl, 'NX');
    return res === 'OK';
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
