import { readFileSync } from 'fs';
import { join } from 'path';

let cached: { appName: string; workDir: string } | null = null;

/**
 * Auto-detect app name and working directory.
 * Reads name from .app-meta.json if available, otherwise derives from directory name.
 * Cached after first call.
 */
export function getAppConfig(): { appName: string; workDir: string } {
  if (cached) return cached;
  const workDir = process.cwd();
  const metaPath = join(workDir, '.app-meta.json');
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta.name || meta.appName) {
      cached = { appName: meta.name || meta.appName, workDir };
      return cached;
    }
  } catch { /* no .app-meta.json or invalid JSON */ }
  // Fallback: derive from directory name
  cached = { appName: workDir.split('/').pop() || 'unknown', workDir };
  return cached;
}
