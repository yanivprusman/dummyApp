import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { launchFeedback, sendMessage, killFeedback, isTmuxAlive, launchFix, launchConclude } from './claude-launcher';
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
    if (tmux.tmuxSession === tmuxSession) { idMap.delete(sid); break; }
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
      const { message, sessionId, tmuxSession, pagePath } = await request.json();

      if (!message || typeof message !== 'string' || !message.trim()) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }

      let csid: string;
      let tmux: string;

      if (!sessionId) {
        const appPort = parseInt(request.nextUrl.port) || undefined;

        const firstMessage = pagePath
          ? `[User is on page: ${pagePath}]\n\n${message.trim()}`
          : message.trim();
        const result = launchFeedback({ appName, workDir, firstMessage, appPort });
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
            { error: 'timeout', message: 'Claude did not respond in time. Check ~/.claude/hooks/feedback-response-hook.sh and FEEDBACK_APP_PORT env var.', sessionId: csid, tmuxSession: tmux },
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
      const { issues, pagePath } = await request.json();

      if (!Array.isArray(issues) || issues.length === 0) {
        return NextResponse.json({ error: 'At least one issue is required' }, { status: 400 });
      }

      const results = await Promise.all(
        issues.map(async (issue: { title: string; description: string }) => {
          try {
            const output = await new Promise<string>((resolve, reject) => {
              const description = pagePath
                ? `[Page: ${pagePath}]\n\n${issue.description}`
                : issue.description;
              execFile(
                '/usr/local/bin/daemon',
                [
                  'send', 'createIssue',
                  '--app', appName,
                  '--title', issue.title,
                  '--description', description,
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

            const data = JSON.parse(output);
            return {
              title: issue.title,
              issueNumber: data.issueNumber,
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
export function handleFeedbackClose(appName: string, dashboardPort = 3007) {
  return async function POST(request: NextRequest) {
    try {
      const { tmuxSession } = await request.json();
      if (tmuxSession) {
        // Extract claudeSessionId before removeSession clears the map
        let claudeSessionId: string | undefined;
        const idMap = getSessionIdMap();
        for (const [sid, entry] of idMap.entries()) {
          if (entry.tmuxSession === tmuxSession) {
            claudeSessionId = sid;
            break;
          }
        }

        killFeedback(tmuxSession, appName);
        removeSession(tmuxSession);

        // Unregister from dashboard session registry
        if (claudeSessionId) {
          const dashboardKey = `${appName}-feedback-${claudeSessionId.slice(0, 8)}`;
          fetch(`http://localhost:${dashboardPort}/api/claude-sessions/${dashboardKey}`, {
            method: 'DELETE',
          }).catch(() => {});
        }
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
export function handleFeedbackSessionEnd(appName: string, dashboardPort = 3007) {
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
        // Unregister from dashboard session registry
        const dashboardKey = `${appName}-feedback-${session_id.slice(0, 8)}`;
        fetch(`http://localhost:${dashboardPort}/api/claude-sessions/${dashboardKey}`, {
          method: 'DELETE',
        }).catch(() => {});
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
 * POST: close, reopen, update, fix, or reviewed action
 */
export function handleFeedbackIssues(appName: string, opts?: { workDir?: string; dashboardPort?: number }) {
  const workDir = opts?.workDir;
  const dashboardPort = opts?.dashboardPort ?? 3007;

  function daemonExec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        '/usr/local/bin/daemon',
        args,
        { timeout: 10_000, maxBuffer: 256 * 1024 },
        (error, stdout, stderr) => {
          if (error) { reject(new Error(stderr || error.message)); return; }
          resolve(stdout.trim());
        },
      );
    });
  }

  async function GET() {
    try {
      const output = await daemonExec(['send', 'listIssues', '--app', appName]);
      const issues = JSON.parse(output);
      return NextResponse.json({ issues, appName });
    } catch (err) {
      console.error(`${appName} issues list error:`, err);
      return NextResponse.json({ error: 'Failed to list issues' }, { status: 500 });
    }
  }

  async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const { action } = body;

      // --- Create issue directly (bypass clarifier) ---
      if (action === 'create') {
        const { title, description } = body;
        if (!title || typeof title !== 'string' || !title.trim()) {
          return NextResponse.json({ error: 'title is required' }, { status: 400 });
        }
        const args = [
          'send', 'createIssue',
          '--app', appName,
          '--title', title.trim(),
          '--description', (description || '').trim(),
          '--labels', '["user-reported"]',
        ];
        const output = await daemonExec(args);
        const data = JSON.parse(output);
        return NextResponse.json({ ok: true, issueNumber: data.issueNumber });
      }

      // --- Fix with Claude ---
      if (action === 'fix') {
        if (!workDir) {
          return NextResponse.json({ error: 'Fix not configured — workDir not set' }, { status: 400 });
        }
        const issues: { number: number; title: string }[] = body.issues;
        if (!Array.isArray(issues) || issues.length === 0) {
          return NextResponse.json({ error: 'issues array required' }, { status: 400 });
        }

        const result = launchFix({ appName, workDir, issues, dashboardPort });

        // Mark issues as in_progress (fire-and-forget)
        for (const issue of issues) {
          daemonExec([
            'send', 'updateIssue', '--app', appName,
            '--issueNumber', String(issue.number),
            '--status', 'in_progress',
            '--claudeSessionId', result.claudeSessionId,
            '--claudeLaunchDir', workDir,
          ]).catch(err => console.error(`${appName} mark in_progress #${issue.number}:`, err.message));
        }

        return NextResponse.json({ ok: true, claudeSessionId: result.claudeSessionId, tmuxSession: result.tmuxSession });
      }

      // --- Mark as Reviewed (close + optional conclude) ---
      if (action === 'reviewed') {
        const issueNumbers: number[] = body.issueNumbers;
        if (!Array.isArray(issueNumbers) || issueNumbers.length === 0) {
          return NextResponse.json({ error: 'issueNumbers array required' }, { status: 400 });
        }

        // Launch conclude if requested (fire-and-forget)
        if (body.conclude && body.claudeSessionId) {
          const concludeDir = body.claudeLaunchDir || workDir;
          if (concludeDir) {
            const concluded = launchConclude({
              appName,
              workDir: concludeDir,
              claudeSessionId: body.claudeSessionId,
              dashboardPort,
            });
            if (!concluded) {
              console.log(`[feedback-lib] conclude: session file not found for ${body.claudeSessionId}, closing without conclude`);
            }
          }
        }

        // Close all specified issues
        const results = await Promise.all(
          issueNumbers.map(async (num) => {
            try {
              await daemonExec(['send', 'closeIssue', '--app', appName, '--issueNumber', String(num)]);
              return { issueNumber: num, ok: true };
            } catch (err) {
              return { issueNumber: num, ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
            }
          }),
        );

        return NextResponse.json({ ok: true, results });
      }

      // --- Standard actions: close, reopen, update ---
      const { issueNumber } = body;
      if (!issueNumber || !['close', 'reopen', 'update'].includes(action)) {
        return NextResponse.json({ error: 'action (close|reopen|update|create|fix|reviewed) and issueNumber required' }, { status: 400 });
      }

      let args: string[];
      if (action === 'update') {
        args = ['send', 'updateIssue', '--app', appName, '--issueNumber', String(issueNumber)];
        if (body.title) args.push('--title', body.title);
        if (body.description !== undefined) args.push('--description', body.description);
      } else {
        const command = action === 'close' ? 'closeIssue' : 'reopenIssue';
        args = ['send', command, '--app', appName, '--issueNumber', String(issueNumber)];
      }

      const output = await daemonExec(args);
      return NextResponse.json({ ok: true, output });
    } catch (err) {
      console.error(`${appName} issue action error:`, err);
      return NextResponse.json({ error: 'Failed to perform action' }, { status: 500 });
    }
  }

  return { GET, POST };
}
