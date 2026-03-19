const pending = new Map<string, { resolve: (text: string) => void }>();

export function waitForResponse(sessionId: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(sessionId);
      reject(new Error('Timeout waiting for Claude response'));
    }, timeoutMs);

    pending.set(sessionId, {
      resolve: (text: string) => {
        clearTimeout(timer);
        pending.delete(sessionId);
        resolve(text);
      },
    });
  });
}

export function resolveResponse(sessionId: string, text: string): boolean {
  const entry = pending.get(sessionId);
  if (entry) {
    entry.resolve(text);
    return true;
  }
  return false;
}
