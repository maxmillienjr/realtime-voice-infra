import type { JtiStore } from '@realtime-voice-infra/session-core';

export interface StoredSession {
  sessionKey: Buffer;
  createdAt: number;
}

export interface SessionStore extends JtiStore {
  putSession(sessionId: string, key: Buffer, ttlSeconds: number): Promise<void>;
  getSession(sessionId: string): Promise<StoredSession | null>;
  deleteSession(sessionId: string): Promise<void>;
  ping(): Promise<boolean>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, { s: StoredSession; exp: number }>();
  private readonly jtis = new Map<string, number>();

  async putSession(sessionId: string, key: Buffer, ttlSeconds: number): Promise<void> {
    this.sessions.set(sessionId, {
      s: { sessionKey: key, createdAt: Date.now() },
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    this.sweep();
    return this.sessions.get(sessionId)?.s ?? null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async consume(jti: string, exp: number): Promise<boolean> {
    this.sweep();
    if (this.jtis.has(jti)) return false;
    this.jtis.set(jti, exp);
    return true;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  private sweep(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [k, v] of this.sessions) if (v.exp <= now) this.sessions.delete(k);
    for (const [k, exp] of this.jtis) if (exp <= now) this.jtis.delete(k);
  }
}
