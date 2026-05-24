// In-memory mapping from browser session id -> Backboard thread id.
// Survives within a single dev-server process; resets on restart.
// For production this should be backed by a real store (Redis, db, signed cookie).

const store = new Map<string, string>();

export function getThreadId(sessionId: string): string | undefined {
  return store.get(sessionId);
}

export function setThreadId(sessionId: string, threadId: string): void {
  store.set(sessionId, threadId);
}

export function clearThreadId(sessionId: string): void {
  store.delete(sessionId);
}
