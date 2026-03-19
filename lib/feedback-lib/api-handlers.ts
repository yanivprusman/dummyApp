import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { launchFeedback, sendMessage, killFeedback, isTmuxAlive } from './claude-launcher';
import { waitForResponse, resolveResponse } from './pending-responses';

/** Track last activity timestamp per tmux session for auto-cleanup.
 *  Use globalThis to avoid Turbopack module duplication (same fix as pending-responses). */
const SESSION_ACTIVITY_KEY = Symbol.for('feedback-lib:session-last-activity');
const CLEANUP_STARTED_KEY = Symbol.for('feedback-lib:cleanup-interval-started');
const SESSION_ID_MAP_KEY = Symbol.for('feedback-lib:session-id-to-tmux');
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

type SessionInfo = { timestamp: number; appName: string };

function getSessionActivityMap(): Map<string, SessionInfo> {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[SESSION_ACTIVITY_KEY]) {
    g[SESSION_ACTIVITY_KEY] = new Map<string, SessionInfo>();
  }
  return g[SESSION_ACTIVITY_KEY] as Map<string, SessionInfo>;
}

function isCleanupStarted(): boolean {
  return !!(globalThis as Record<symbol, unknown>)[CLEANUP_STARTED_KEY];
}

function markCleanupStarted(): void {
  (globalThis as Record<symbol, unknown>)[CLEANUP_STARTED_KEY] = true;
}

function startSessionCleanupInterval() {
  if (isCleanupStarted()) return;
  markCleanupStarted();

  setInterval(() => {
    const sessionLastActivity = getSessionActivityMap();
    const now = Date.now();
    for (const [tmux, info] of sessionLastActivity.entries()) {
      if (now - info.timestamp > SESSION_TIMEOUT_MS) {
        killFeedback(tmux, info.appName);
        sessionLastActivity.delete(tmux);
      }
    }
  }, 60_000); // Check every minute
}

function touchSession(tmuxSession: string, appName: string) {
  getSessionActivityMap().set(tmuxSession, { timestamp: Date.now(), appName });
}

function removeSession(tmuxSession: string) {
  getSessionActivityMap().delete(tmuxSession);
  // Also remove from sessionId→tmux map
  const idMap = getSessionIdMap();
  for (const [sid, tmux] of idMap.entries()) {
    if (tmux === tmuxSession) { idMap.delete(sid); break; }
  }
}

/** Map Claude sessionId → { tmuxSession, appName } for SessionEnd hook lookup */
function getSessionIdMap(): Map<string, { tmuxSession: string; appName: string }> {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[SESSION_ID_MAP_KEY]) {
    g[SESSION_ID_MAP_KEY] = new Map<string, { tmuxSession: string; appName: string }>();
  }
  return g[SESSION_ID_MAP_KEY] as Map<string, { tmuxSession: string; appName: string }>;
}

function trackSessionId(sessionId: string, tmuxSession: string, appName: string) {
  getSessionIdMap().set(sessionId, { tmuxSession, appName });
}

/**
 * Returns a POST handler for /api/feedback
 * Launches or messages the Claude issue-clarifier session.
 */
export function handleFeedbackMessage(appName: string, workDir: string) {
  startSessionCleanupInterval();

  return async function POST(request: NextRequest) {
    try {
      const { message, sessionId, tmuxSession } = await request.json();

      if (!message || typeof message !== 'string' || !message.trim()) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }

      let csid: string;
      let tmux: string;
      let hookWarning: string | undefined;

      if (!sessionId) {
        // Check Stop hook config before launching
        hookWarning = checkStopHookConfig(workDir);

        const result = launchFeedback({ appName, workDir, firstMessage: message.trim() });
        csid = result.claudeSessionId;
        tmux = result.tmuxSession;
        trackSessionId(csid, tmux, appName);
      } else {
        csid = sessionId;
        tmux = tmuxSession;
        sendMessage(tmux, message.trim());
      }

      touchSession(tmux, appName);

      let response: string;
      try {
        response = await waitForResponse(csid, 120_000);
      } catch (err) {
        const isTimeout = err instanceof Error && err.message.includes('Timeout');
        if (isTimeout) {
          return NextResponse.json(
            { error: 'timeout', message: 'Claude session did not respond — the Stop hook may be misconfigured. Check .claude/settings.local.json in the app directory.', sessionId: csid, tmuxSession: tmux },
            { status: 504 },
          );
        }
        throw err;
      }

      // Check if the response contains a fenced JSON block with issues
      const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/);
      let issues: { title: string; description: string }[] | undefined;
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (Array.isArray(parsed) && parsed.every((item: Record<string, unknown>) => item.title && item.description)) {
            issues = parsed;
          }
        } catch { /* Not valid JSON — ignore */ }
      }

      return NextResponse.json({
        response,
        sessionId: csid,
        tmuxSession: tmux,
        ...(issues && { issues }),
        ...(hookWarning && { hookWarning }),
      });
    } catch (err) {
      console.error(`${appName} feedback API error:`, err);
      return NextResponse.json(
        { error: 'server', message: 'Failed to process feedback. Please try again.' },
        { status: 500 },
      );
    }
  };
}

function checkStopHookConfig(workDir: string): string | undefined {
  const settingsPath = `${workDir}/.claude/settings.local.json`;
  try {
    if (!existsSync(settingsPath)) {
      return 'Stop hook config not found at .claude/settings.local.json — responses may not work.';
    }
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const hooks = settings?.hooks?.Stop;
    if (!hooks || !Array.isArray(hooks) || hooks.length === 0) {
      return 'No Stop hook configured in .claude/settings.local.json — responses may not work.';
    }
  } catch {
    return 'Could not read Stop hook config — responses may not work.';
  }
  return undefined;
}

/**
 * Returns a POST handler for /api/feedback/response
 * Called by the Claude Code Stop hook.
 */
export function handleFeedbackResponse() {
  return async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const { session_id, last_assistant_message } = body;

      console.log(`[feedback-lib] handleFeedbackResponse received: session_id=${session_id}, has_message=${!!last_assistant_message}`);

      if (session_id && last_assistant_message) {
        const resolved = resolveResponse(session_id, last_assistant_message);
        console.log(`[feedback-lib] handleFeedbackResponse resolve result: ${resolved}`);
      }

      return NextResponse.json({});
    } catch {
      return NextResponse.json({});
    }
  };
}

/**
 * Returns a POST handler for /api/feedback/submit
 * Creates issues in the daemon tracker for the given app.
 */
export function handleFeedbackSubmit(appName: string) {
  return async function POST(request: NextRequest) {
    try {
      const { issues } = await request.json();

      if (!Array.isArray(issues) || issues.length === 0) {
        return NextResponse.json({ error: 'At least one issue is required' }, { status: 400 });
      }

      const results = await Promise.all(
        issues.map(async (issue: { title: string; description: string }) => {
          try {
            const output = await new Promise<string>((resolve, reject) => {
              execFile(
                '/usr/local/bin/daemon',
                [
                  'send', 'createIssue',
                  '--app', appName,
                  '--title', issue.title,
                  '--description', issue.description,
                  '--labels', '["user-reported"]',
                ],
                { timeout: 10_000, maxBuffer: 64 * 1024 },
                (error, stdout, stderr) => {
                  if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                  }
                  resolve(stdout.trim());
                },
              );
            });

            const match = output.match(/#(\d+)/);
            return {
              title: issue.title,
              issueNumber: match ? parseInt(match[1], 10) : undefined,
              success: true,
            };
          } catch (err) {
            return {
              title: issue.title,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            };
          }
        }),
      );

      return NextResponse.json({ results });
    } catch (err) {
      console.error(`${appName} feedback submit error:`, err);
      return NextResponse.json({ error: 'Failed to submit issues' }, { status: 500 });
    }
  };
}

/**
 * Returns a POST handler for /api/feedback/close
 * Kills the tmux session and cleans up tmp files.
 */
export function handleFeedbackClose(appName: string) {
  return async function POST(request: NextRequest) {
    try {
      const { tmuxSession } = await request.json();
      if (tmuxSession) {
        killFeedback(tmuxSession, appName);
        removeSession(tmuxSession);
      }
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: 'Failed to close session' }, { status: 500 });
    }
  };
}

/**
 * Returns a GET handler for /api/feedback/status
 * Checks if a tmux session is still alive.
 */
export function handleFeedbackStatus() {
  return async function GET(request: NextRequest) {
    try {
      const tmuxSession = request.nextUrl.searchParams.get('tmuxSession');
      if (!tmuxSession) {
        return NextResponse.json({ error: 'tmuxSession parameter required' }, { status: 400 });
      }
      const alive = isTmuxAlive(tmuxSession);
      return NextResponse.json({ alive });
    } catch {
      return NextResponse.json({ alive: false });
    }
  };
}

/**
 * Returns a POST handler for /api/feedback/session-end
 * Called by the Claude Code SessionEnd hook when a session exits.
 * Kills the associated tmux session and cleans up tracking state.
 */
export function handleFeedbackSessionEnd(appName: string) {
  return async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const { session_id } = body;

      if (!session_id) {
        return NextResponse.json({ ok: true }); // Nothing to do
      }

      const idMap = getSessionIdMap();
      const entry = idMap.get(session_id);

      if (entry) {
        killFeedback(entry.tmuxSession, entry.appName);
        removeSession(entry.tmuxSession);
        console.log(`[feedback-lib] SessionEnd: killed tmux=${entry.tmuxSession} for session=${session_id}`);
      } else {
        console.log(`[feedback-lib] SessionEnd: no tracked tmux for session=${session_id}`);
      }

      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error(`[feedback-lib] SessionEnd error:`, err);
      return NextResponse.json({ ok: true }); // Don't fail the hook
    }
  };
}

/**
 * Returns a handler for /api/feedback/issues
 * GET: list issues for the app
 * POST: close or reopen an issue
 */
export function handleFeedbackIssues(appName: string) {
  async function GET() {
    try {
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          '/usr/local/bin/daemon',
          ['send', 'listIssues', '--app', appName],
          { timeout: 10_000, maxBuffer: 256 * 1024 },
          (error, stdout, stderr) => {
            if (error) { reject(new Error(stderr || error.message)); return; }
            resolve(stdout.trim());
          },
        );
      });

      // Parse daemon output — it returns JSON
      const issues = JSON.parse(output);
      return NextResponse.json({ issues });
    } catch (err) {
      console.error(`${appName} issues list error:`, err);
      return NextResponse.json({ error: 'Failed to list issues' }, { status: 500 });
    }
  }

  async function POST(request: NextRequest) {
    try {
      const { action, issueNumber } = await request.json();

      if (!issueNumber || !['close', 'reopen'].includes(action)) {
        return NextResponse.json({ error: 'action (close|reopen) and issueNumber required' }, { status: 400 });
      }

      const command = action === 'close' ? 'closeIssue' : 'reopenIssue';
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          '/usr/local/bin/daemon',
          ['send', command, '--app', appName, '--issueNumber', String(issueNumber)],
          { timeout: 10_000, maxBuffer: 64 * 1024 },
          (error, stdout, stderr) => {
            if (error) { reject(new Error(stderr || error.message)); return; }
            resolve(stdout.trim());
          },
        );
      });

      return NextResponse.json({ ok: true, output });
    } catch (err) {
      console.error(`${appName} issue action error:`, err);
      return NextResponse.json({ error: 'Failed to perform action' }, { status: 500 });
    }
  }

  return { GET, POST };
}
