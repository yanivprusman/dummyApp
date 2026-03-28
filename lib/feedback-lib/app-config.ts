import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

let cached: { appName: string; workDir: string } | null = null;

function getGitRoot(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Auto-detect app name and working directory.
 * Reads name from .app-meta.json if available, otherwise derives from directory name.
 * workDir is the git root (so Claude sessions group correctly), not necessarily cwd.
 * Cached after first call.
 */
export function getAppConfig(): { appName: string; workDir: string } {
  if (cached) return cached;
  const cwd = process.cwd();
  const workDir = getGitRoot(cwd) || cwd;
  const metaPath = join(cwd, '.app-meta.json');
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
