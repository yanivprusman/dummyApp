import crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { getSessionEnv } from './session-env';

export interface LaunchConfig {
  appName: string;
  workDir: string;
  firstMessage: string;
  /** User to run Claude as (default: 'root') */
  user?: string;
  /** Dashboard dev port for session registration (default: 3007) */
  dashboardPort?: number;
  /** Port the app's Next.js server is running on (for global Stop hook routing) */
  appPort?: number;
}

export interface LaunchResult {
  claudeSessionId: string;
  tmuxSession: string;
  scriptLogFile: string;
}

export function launchFeedback(config: LaunchConfig): LaunchResult {
  const { appName, workDir, firstMessage, user = 'root', dashboardPort = 3007, appPort } = config;

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
  if (appPort) envArgs.push(`FEEDBACK_APP_PORT=${appPort}`);

  writeFileSync(launchScriptFile, bashCmd + '\n', { mode: 0o755 });

  // Kill existing tmux session if any
  try {
    execFileSync('tmux', ['kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch { /* no existing session */ }

  // Launch in tmux
  execFile('env', [
    ...envArgs,
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
      launchMethod: 'tmux',
      source: 'terminal',
    }),
  }).catch(() => {});

  return { claudeSessionId, tmuxSession, scriptLogFile };
}

export function sendMessage(tmuxSession: string, message: string, user = 'root'): void {
  // Send text literally (no special key parsing)
  execFileSync('tmux', [
    'send-keys', '-t', tmuxSession, '-l', message,
  ], { timeout: 5000 });

  // Send Enter to submit
  execFileSync('tmux', [
    'send-keys', '-t', tmuxSession, 'Enter',
  ], { timeout: 5000 });
}

export function killFeedback(tmuxSession: string, appName?: string, user = 'root'): boolean {
  try {
    execFileSync('tmux', ['kill-session', '-t', tmuxSession], { timeout: 3000 });
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
export function isTmuxAlive(tmuxSession: string, user = 'root'): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', tmuxSession], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export interface FixConfig {
  appName: string;
  workDir: string;
  issues: { number: number; title: string }[];
  user?: string;
  dashboardPort?: number;
}

/**
 * Launch a Claude session to fix issues using /fix-issues-skill.
 */
export function launchFix(config: FixConfig): LaunchResult {
  const { appName, workDir, issues, user = 'root', dashboardPort = 3007 } = config;

  const claudeSessionId = crypto.randomUUID();
  const tmuxSession = `${appName}-fix-${Date.now().toString(36)}`;
  const scriptLogFile = `/tmp/${appName}-claude-${tmuxSession}.log`;
  const launchScriptFile = `/tmp/${appName}-launch-${tmuxSession}.sh`;

  const issueList = issues.map(i => `- #${i.number}: ${i.title} (repo:${appName})`).join('\n');
  const prompt = `/fix-issues-skill ${appName}\n\nIssues to fix:\n${issueList}`;

  const claudeFlags = [
    `--session-id ${claudeSessionId}`,
    '--dangerously-skip-permissions',
  ];
  const claudeCmd = ['claude', ...claudeFlags].join(' ');

  const bashEscapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

  const bashCmd = `cd '${workDir}' && ${claudeCmd} $'${bashEscapedPrompt}'; exec bash`;

  const sessionEnv = getSessionEnv(user);
  const envArgs = Object.entries(sessionEnv).map(([k, v]) => `${k}=${v}`);
  envArgs.push(`CLAUDE_SESSION_ID=${claudeSessionId}`);
  envArgs.push(`CLAUDE_LAUNCH_DIR=${workDir}`);

  writeFileSync(launchScriptFile, bashCmd + '\n', { mode: 0o755 });

  try {
    execFileSync('tmux', ['kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch { /* no existing session */ }

  execFile('env', [
    ...envArgs,
    'tmux', 'new-session', '-d', '-s', tmuxSession,
    `script -qf ${scriptLogFile} -c 'bash -l ${launchScriptFile}'`,
  ], { timeout: 10000 }, (err) => {
    if (err) console.error(`${appName} fix launch failed:`, err.message);
  });

  // Register with dashboard (fire-and-forget)
  fetch(`http://localhost:${dashboardPort}/api/claude-sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: `${appName}-fix-${claudeSessionId.slice(0, 8)}`,
      claudeSessionId,
      appName,
      workDir,
      scriptFile: scriptLogFile,
      termTitle: tmuxSession,
      launchMethod: 'tmux',
      source: 'terminal',
    }),
  }).catch(() => {});

  return { claudeSessionId, tmuxSession, scriptLogFile };
}

export interface ConcludeConfig {
  appName: string;
  workDir: string;
  claudeSessionId: string;
  user?: string;
  dashboardPort?: number;
}

/**
 * Resume a Claude session and run /conclude-issues-skill.
 * Returns null if the session file doesn't exist (cleaned up).
 */
export function launchConclude(config: ConcludeConfig): { tmuxSession: string } | null {
  const { appName, workDir, claudeSessionId, user = 'root', dashboardPort = 3007 } = config;

  const home = process.env.HOME || '/root';
  const projectKey = workDir.replace(/\//g, '-');
  const sessionFile = `${home}/.claude/projects/${projectKey}/${claudeSessionId}.jsonl`;
  if (!existsSync(sessionFile)) return null;

  const tmuxSession = `${appName}-conclude-${Date.now().toString(36)}`;
  const scriptLogFile = `/tmp/${appName}-claude-${tmuxSession}.log`;
  const launchScriptFile = `/tmp/${appName}-launch-${tmuxSession}.sh`;

  const claudeCmd = `claude -r ${claudeSessionId} --dangerously-skip-permissions`;
  const bashCmd = `cd '${workDir}' && ${claudeCmd} $'/conclude-issues-skill'; exec bash`;

  const sessionEnv = getSessionEnv(user);
  const envArgs = Object.entries(sessionEnv).map(([k, v]) => `${k}=${v}`);
  envArgs.push(`CLAUDE_SESSION_ID=${claudeSessionId}`);
  envArgs.push(`CLAUDE_LAUNCH_DIR=${workDir}`);

  writeFileSync(launchScriptFile, bashCmd + '\n', { mode: 0o755 });

  try {
    execFileSync('tmux', ['kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch { /* no existing session */ }

  execFile('env', [
    ...envArgs,
    'tmux', 'new-session', '-d', '-s', tmuxSession,
    `script -qf ${scriptLogFile} -c 'bash -l ${launchScriptFile}'`,
  ], { timeout: 10000 }, (err) => {
    if (err) console.error(`${appName} conclude launch failed:`, err.message);
  });

  // Register with dashboard (fire-and-forget)
  fetch(`http://localhost:${dashboardPort}/api/claude-sessions/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: `${appName}-conclude-${claudeSessionId.slice(0, 8)}`,
      claudeSessionId,
      appName,
      workDir,
      scriptFile: scriptLogFile,
      termTitle: tmuxSession,
      launchMethod: 'tmux',
      source: 'terminal',
    }),
  }).catch(() => {});

  return { tmuxSession };
}
