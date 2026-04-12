import { AsyncLocalStorage } from 'node:async_hooks';
import { pino } from 'pino';

export interface LogContext {
  session_id?: string;
  frame_sequence?: number;
}

const als = new AsyncLocalStorage<LogContext>();

export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  mixin() {
    return als.getStore() ?? {};
  },
});

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const existing = als.getStore() ?? {};
  return als.run({ ...existing, ...ctx }, fn);
}

export function updateLogContext(ctx: LogContext): void {
  const existing = als.getStore();
  if (existing) Object.assign(existing, ctx);
}
