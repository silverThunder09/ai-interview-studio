/** Inspect CLI cached-login status only: no Cloud request and no Secret write-back. */
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, open, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { classifyCliFailure } from './codex-ci-auth.mjs';

const execFile = promisify(execFileCallback);
const REPO = 'silverThunder09/ai-interview-studio';
const safeEnv = () => Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TZ', 'RUNNER_TEMP', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));

/** Only fixed classifications are returned; CLI output and auth content stay private. */
export async function inspectCachedLogin({ prepare, runStatus, cleanup }) {
  let result;
  try {
    await prepare();
    try {
      const output = await runStatus();
      const lines = `${typeof output?.stdout === 'string' ? output.stdout : ''}\n${typeof output?.stderr === 'string' ? output.stderr : ''}`.split(/\r?\n/).map(line => line.trim());
      result = lines.includes('Logged in using ChatGPT') ? { state: 'cached_chatgpt', reason: 'none' } : { state: 'other_or_unconfirmed', reason: 'unsupported_login_type' };
    } catch (error) { result = { state: 'login_status_unconfirmed', reason: classifyCliFailure(error) }; }
  } catch { result = { state: 'setup_unconfirmed', reason: 'unclassified' }; }
  try { await cleanup(); } catch { result = { state: 'cleanup_unconfirmed', reason: 'unclassified' }; }
  return result;
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('untrusted_context');
  let seed = process.env.AIS_CODEX_AUTH_JSON, path;
  delete process.env.AIS_CODEX_AUTH_JSON;
  if (typeof seed !== 'string' || !seed.length) throw new Error('missing_config');
  const result = await inspectCachedLogin({
    prepare: async () => {
      const directory = join(homedir(), '.codex');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const candidate = join(directory, 'auth.json');
      const file = await open(candidate, 'wx', 0o600);
      path = candidate;
      try { await file.writeFile(seed); } finally { seed = undefined; await file.close(); }
    },
    runStatus: () => {
      const cli = join(process.env.RUNNER_TEMP, 'codex-auth-cli', 'node_modules', '.bin', 'codex');
      return execFile(cli, ['login', 'status'], { env: safeEnv(), timeout: 60000, maxBuffer: 1024 * 1024 });
    },
    cleanup: async () => { if (path) await rm(path, { force: true }); }
  });
  console.log(JSON.stringify(result));
  if (result.state !== 'cached_chatgpt') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error(JSON.stringify({ state: 'setup_unconfirmed', reason: 'unclassified' })); process.exitCode = 1; });
