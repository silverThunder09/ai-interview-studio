/** Read-only Cloud probe with serialized, fail-closed credential write-back. */
/* global fetch, AbortSignal */
import { createPrivateKey, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, open, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
const REPO = 'silverThunder09/ai-interview-studio';
const SECRET = 'AIS_CODEX_AUTH_JSON';
const ensure = (condition, reason) => { if (!condition) throw new Error(reason); };
export const seedPredatesRun = (secretUpdated, runCreated) => {
  const secretTime = Date.parse(secretUpdated), runTime = Date.parse(runCreated);
  return Number.isFinite(secretTime) && Number.isFinite(runTime) && secretTime < runTime;
};
const safeEnv = () => Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TZ', 'RUNNER_TEMP', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));

export async function storeSecret(path, token, command = 'gh') {
  await new Promise((resolve, reject) => {
    const child = spawn(command, ['secret', 'set', SECRET, '--repo', REPO], { env: { ...safeEnv(), GH_TOKEN: token }, stdio: ['pipe', 'ignore', 'ignore'] });
    const source = createReadStream(path);
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    let inputFailed = false;
    source.on('error', () => { inputFailed = true; child.kill(); });
    child.stdin.on('error', () => { inputFailed = true; });
    child.on('error', () => { clearTimeout(timer); source.destroy(); reject(new Error('writeback_failed')); });
    child.on('close', code => { clearTimeout(timer); source.destroy(); if (code === 0 && !inputFailed) resolve(); else reject(new Error('writeback_failed')); });
    source.pipe(child.stdin);
  });
}

/** Convert CLI errors to fixed categories; never return command output or exception text. */
export function classifyCliFailure(error) {
  if (error?.killed || error?.code === 'ETIMEDOUT') return 'timeout';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'].includes(error?.code)) return 'network_error';
  const stderr = typeof error?.stderr === 'string' ? error.stderr.slice(0, 16384) : '';
  const stdout = typeof error?.stdout === 'string' ? error.stdout.slice(0, 16384) : '';
  const text = `${stderr}\n${stdout}`;
  if (/\bnot logged in\b/i.test(text)) return 'not_logged_in';
  if (/could not parse (?:your )?authentication token/i.test(text)) return 'invalid_auth_token';
  const match = text.match(/\b(?:http|status)(?:\s*(?:code)?\s*[:=]?)?\s*(401|403|429|5[0-9][0-9])\b/i);
  if (match) return match[1].startsWith('5') ? 'http_5xx' : `http_${match[1]}`;
  return 'unclassified';
}

/** A failed login must not be reported as a Cloud list attempt. */
export async function inspectCloudLogin(run) {
  try { await run(['login', 'status']); }
  catch (error) { return { stage: 'login_status', outcome: 'unconfirmed', reason: classifyCliFailure(error) }; }
  try { await run(['cloud', 'list', '--limit', '1', '--json']); }
  catch (error) { return { stage: 'cloud_list', outcome: 'unconfirmed', reason: classifyCliFailure(error) }; }
  return { stage: 'cloud_list', outcome: 'ok', reason: 'none' };
}

/** The caller supplies the only operations that can touch credentials or the network. */
export async function maintainAuth({ prepare, probe, persist, cleanup }) {
  let result;
  try {
    await prepare(); // Do not run the CLI until write-back permission is confirmed.
    try { result = await probe() ? 'cloud_list_ok' : 'cloud_list_unconfirmed'; }
    catch { result = 'cloud_list_unconfirmed'; }
    // Even a failed CLI call may have rotated credentials: save the current file.
    try { await persist(); } catch { result = 'writeback_unconfirmed'; }
  } catch { result = 'preflight_failed'; }
  try { await cleanup(); } catch { result = 'cleanup_unconfirmed'; }
  return result;
}

async function main() {
  ensure(process.env.GITHUB_REPOSITORY === REPO && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === 'refs/heads/main', 'untrusted_context');
  const appId = process.env.AIS_PR_WRITER_APP_ID, installation = process.env.AIS_PR_WRITER_INSTALLATION_ID;
  const repoId = Number(process.env.GITHUB_REPOSITORY_ID), privateKey = process.env.AIS_PR_WRITER_PRIVATE_KEY;
  let seed = process.env.AIS_CODEX_AUTH_JSON, token, path, expectedSecretUpdate;
  delete process.env.AIS_CODEX_AUTH_JSON;
  delete process.env.AIS_PR_WRITER_PRIVATE_KEY;
  ensure(/^[1-9]\d*$/.test(appId ?? '') && /^[1-9]\d*$/.test(installation ?? '') && /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? '') && typeof process.env.GITHUB_TOKEN === 'string' && Number.isSafeInteger(repoId) && repoId > 0 && typeof privateKey === 'string' && typeof seed === 'string' && seed.length > 0, 'missing_configuration');
  const request = async (method, url, bearer, body) => {
    const response = await fetch(`https://api.github.com${url}`, { method, headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
    ensure(response.ok, 'github_request_failed');
    return response.status === 204 ? null : response.json();
  };
  let probeDetail;
  const result = await maintainAuth({
    prepare: async () => {
      const key = createPrivateKey(privateKey);
      ensure(key.asymmetricKeyType === 'rsa', 'invalid_key');
      const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
      const issued = Math.floor(Date.now() / 1000);
      const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: issued - 30, exp: issued + 540, iss: appId })}`;
      const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
      const grant = await request('POST', `/app/installations/${installation}/access_tokens`, jwt, { repository_ids: [repoId], permissions: { secrets: 'write' } });
      token = grant?.token;
      ensure(typeof token === 'string' && token.length > 0 && grant.permissions?.secrets === 'write' && Object.entries(grant.permissions).every(([k,v]) => (k === 'secrets' && v === 'write') || (k === 'metadata' && v === 'read')) && grant.repositories?.length === 1 && grant.repositories[0].id === repoId && grant.repositories[0].full_name === REPO, 'invalid_app_grant');
      const metadata = await request('GET', `/repos/${REPO}/actions/secrets/${SECRET}`, token);
      const run = await request('GET', `/repos/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`, process.env.GITHUB_TOKEN);
      ensure(run?.event === 'workflow_dispatch' && run?.head_branch === 'main' && seedPredatesRun(metadata?.updated_at, run?.created_at), 'stale_queued_secret');
      expectedSecretUpdate = metadata.updated_at;
      const directory = join(homedir(), '.codex');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const candidate = join(directory, 'auth.json');
      const file = await open(candidate, 'wx', 0o600);
      path = candidate;
      try { await file.writeFile(seed); } finally { await file.close(); seed = undefined; }
    },
    probe: async () => {
      const cli = join(process.env.RUNNER_TEMP, 'codex-auth-cli', 'node_modules', '.bin', 'codex');
      const options = { env: safeEnv(), timeout: 60000, maxBuffer: 1024 * 1024 };
      probeDetail = await inspectCloudLogin(args => execFile(cli, args, options));
      return probeDetail.outcome === 'ok';
    },
    persist: async () => {
      // Refuse to overwrite a secret updated during this run. This is not a GitHub CAS.
      const metadata = await request('GET', `/repos/${REPO}/actions/secrets/${SECRET}`, token);
      ensure(metadata?.updated_at === expectedSecretUpdate, 'secret_changed');
      // gh encrypts the file using GitHub's public key; no credential appears in argv or output.
      await storeSecret(path, token);
    },
    cleanup: async () => {
      let failed = false;
      if (path) try { await rm(path, { force: true }); } catch { failed = true; }
      if (token) try { await request('DELETE', '/installation/token', token); } catch { failed = true; }
      if (failed) throw new Error('cleanup_failed');
    }
  });
  console.log(JSON.stringify({ state: result, ...(probeDetail ? { probe: probeDetail } : {}) }));
  if (result !== 'cloud_list_ok') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'configuration_or_runtime_unavailable' })); process.exitCode = 1; });
}
