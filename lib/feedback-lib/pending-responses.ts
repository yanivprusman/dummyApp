// Use globalThis with Symbol.for() to guarantee a single Map instance
// across all Turbopack module copies in the same Node.js process.
const PENDING_KEY = Symbol.for('feedback-lib:pending-responses');

type PendingEntry = { resolve: (text: string) => void };

function getPendingMap(): Map<string, PendingEntry> {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[PENDING_KEY]) {
    g[PENDING_KEY] = new Map<string, PendingEntry>();
  }
  return g[PENDING_KEY] as Map<string, PendingEntry>;
}

export function waitForResponse(sessionId: string, timeoutMs: number): Promise<string> {
  const pending = getPendingMap();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(sessionId);
      console.log(`[feedback-lib] waitForResponse TIMEOUT for session ${sessionId} (pending size: ${pending.size})`);
      reject(new Error('Timeout waiting for Claude response'));
    }, timeoutMs);

    pending.set(sessionId, {
      resolve: (text: string) => {
        clearTimeout(timer);
        pending.delete(sessionId);
        console.log(`[feedback-lib] waitForResponse RESOLVED for session ${sessionId}`);
        resolve(text);
      },
    });
    console.log(`[feedback-lib] waitForResponse REGISTERED for session ${sessionId} (pending size: ${pending.size})`);
  });
}

export function resolveResponse(sessionId: string, text: string): boolean {
  const pending = getPendingMap();
  const entry = pending.get(sessionId);
  if (entry) {
    console.log(`[feedback-lib] resolveResponse FOUND session ${sessionId} (pending size: ${pending.size})`);
    entry.resolve(text);
    return true;
  }
  console.log(`[feedback-lib] resolveResponse MISS for session ${sessionId} (pending size: ${pending.size}, keys: [${[...pending.keys()].join(', ')}])`);
  return false;
}
