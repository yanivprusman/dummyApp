import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { launchFeedback, sendMessage, killFeedback, isTmuxAlive } from './claude-launcher';
import { waitForResponse, resolveResponse } from './pending-responses';

/** Track last activity timestamp per tmux session for auto-cleanup */
const sessionLastActivity = new Map<string, { timestamp: number; appName: string }>();
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let cleanupIntervalStarted = false;

function startSessionCleanupInterval() {
  if (cleanupIntervalStarted) return;
  cleanupIntervalStarted = true;

  setInterval(() => {
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
  sessionLastActivity.set(tmuxSession, { timestamp: Date.now(), appName });
}

function removeSession(tmuxSession: string) {
  sessionLastActivity.delete(tmuxSession);
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

      if (session_id && last_assistant_message) {
        resolveResponse(session_id, last_assistant_message);
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
