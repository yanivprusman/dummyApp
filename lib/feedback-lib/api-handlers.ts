import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { launchFeedback, sendMessage, killFeedback } from './claude-launcher';
import { waitForResponse, resolveResponse } from './pending-responses';

/**
 * Returns a POST handler for /api/feedback
 * Launches or messages the Claude issue-clarifier session.
 */
export function handleFeedbackMessage(appName: string, workDir: string) {
  return async function POST(request: NextRequest) {
    try {
      const { message, sessionId, tmuxSession } = await request.json();

      if (!message || typeof message !== 'string' || !message.trim()) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 });
      }

      let csid: string;
      let tmux: string;

      if (!sessionId) {
        const result = launchFeedback({ appName, workDir, firstMessage: message.trim() });
        csid = result.claudeSessionId;
        tmux = result.tmuxSession;
      } else {
        csid = sessionId;
        tmux = tmuxSession;
        sendMessage(tmux, message.trim());
      }

      const response = await waitForResponse(csid, 120_000);

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
        { error: 'Failed to process feedback. Please try again.' },
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
 * Kills the tmux session.
 */
export function handleFeedbackClose() {
  return async function POST(request: NextRequest) {
    try {
      const { tmuxSession } = await request.json();
      if (tmuxSession) {
        killFeedback(tmuxSession);
      }
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: 'Failed to close session' }, { status: 500 });
    }
  };
}
