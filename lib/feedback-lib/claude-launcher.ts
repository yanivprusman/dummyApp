import crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { getSessionEnv } from './session-env';

export interface LaunchConfig {
  appName: string;
  workDir: string;
  firstMessage: string;
  /** User to run Claude as (default: 'yaniv') */
  user?: string;
  /** Dashboard dev port for session registration (default: 3007) */
  dashboardPort?: number;
}

export interface LaunchResult {
  claudeSessionId: string;
  tmuxSession: string;
  scriptLogFile: string;
}

export function launchFeedback(config: LaunchConfig): LaunchResult {
  const { appName, workDir, firstMessage, user = 'yaniv', dashboardPort = 3007 } = config;

  const claudeSessionId = crypto.randomUUID();
  const tmuxSession = `${appName}-feedback-${Date.now().toString(36)}`;
  const scriptLogFile = `/tmp/${appName}-claude-${tmuxSession}.log`;
  const launchScriptFile = `/tmp/${appName}-launch-${tmuxSession}.sh`;

  const claudeFlags = [
    `--session-id ${claudeSessionId}`,
    '--agent issue-clarifier-agent',
    '--dangerously-skip-permissions',
  ];
  const claudeCmd = ['claude', ...claudeFlags].join(' ');

  // Escape prompt for bash $'...' syntax
  const bashEscapedPrompt = firstMessage
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

  const bashCmd = `cd '${workDir}' && ${claudeCmd} $'${bashEscapedPrompt}'; exec bash`;

  // Get session env vars for runuser
  const sessionEnv = getSessionEnv(user);
  const envArgs = Object.entries(sessionEnv).map(([k, v]) => `${k}=${v}`);
  envArgs.push(`CLAUDE_SESSION_ID=${claudeSessionId}`);
  envArgs.push(`CLAUDE_LAUNCH_DIR=${workDir}`);

  writeFileSync(launchScriptFile, bashCmd + '\n', { mode: 0o755 });

  // Kill existing tmux session if any
  try {
    execFileSync('runuser', ['-u', user, '--', 'tmux', 'kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch { /* no existing session */ }

  // Launch in tmux
  execFile('runuser', [
    '-u', user, '--', 'env', ...envArgs,
    'tmux', 'new-session', '-d', '-s', tmuxSession,
    `script -qf ${scriptLogFile} -c 'bash -l ${launchScriptFile}'`,
  ], { timeout: 10000 }, (err) => {
    if (err) console.error(`${appName} claude launch failed:`, err.message);
  });

  // Register with dashboard (fire-and-forget)
  fetch(`http://localhost:${dashboardPort}/api/claude-sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: `${appName}-feedback-${claudeSessionId.slice(0, 8)}`,
      claudeSessionId,
      appName,
      workDir,
      scriptFile: scriptLogFile,
      termTitle: tmuxSession,
      useTmux: true,
      source: 'terminal',
    }),
  }).catch(() => {});

  return { claudeSessionId, tmuxSession, scriptLogFile };
}

export function sendMessage(tmuxSession: string, message: string, user = 'yaniv'): void {
  // Send text literally (no special key parsing)
  execFileSync('runuser', [
    '-u', user, '--',
    'tmux', 'send-keys', '-t', tmuxSession, '-l', message,
  ], { timeout: 5000 });

  // Send Enter to submit
  execFileSync('runuser', [
    '-u', user, '--',
    'tmux', 'send-keys', '-t', tmuxSession, 'Enter',
  ], { timeout: 5000 });
}

export function killFeedback(tmuxSession: string, appName?: string, user = 'yaniv'): boolean {
  try {
    execFileSync('runuser', ['-u', user, '--', 'tmux', 'kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch {
    // Session may already be dead — still clean up tmp files
  }

  // Clean up tmp files
  if (appName) {
    for (const prefix of ['launch', 'claude']) {
      try { unlinkSync(`/tmp/${appName}-${prefix}-${tmuxSession}.sh`); } catch {}
      try { unlinkSync(`/tmp/${appName}-${prefix}-${tmuxSession}.log`); } catch {}
    }
  }

  return true;
}

/**
 * Check if a tmux session is still alive.
 */
export function isTmuxAlive(tmuxSession: string, user = 'yaniv'): boolean {
  try {
    execFileSync('runuser', ['-u', user, '--', 'tmux', 'has-session', '-t', tmuxSession], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
