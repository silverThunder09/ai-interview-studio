/** One GitHub-hosted tick; existing Cloud credentials are saved even on failure. */
/* global fetch, AbortSignal */
import { Buffer } from 'node:buffer';
import { createPrivateKey, sign } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { maintainAuth, seedPredatesRun, storeSecret } from './codex-ci-auth.mjs';
import { readRecordedCloudTask, runDirectRunner } from './direct-runner.mjs';

const REPO = 'silverThunder09/ai-interview-studio';
const SECRET = 'AIS_CODEX_AUTH_JSON';
const STATES = new Set(['idle', 'sent', 'leased', 'paused', 'disabled', 'stopped', 'needs-user', 'resumption-hold', 'waiting-actions', 'history-hold', 'limits-hold', 'main-ci-hold', 'writer-hold', 'waiting-bootstrap-ci', 'waiting-ci', 'waiting-cloud', 'waiting-direct-cloud', 'waiting-main-ci', 'waiting-planner-auth', 'waiting-planning-ci', 'waiting-transport', 'direct-waiting', 'direct-hold_empty_diff', 'direct-hold_unknown_failure', 'preflight_changed', 'ambiguous_delivery', 'receipt_persistence_unknown', 'wakeup-pending', 'wakeup-sent', 'wakeup-unknown']);
function ensure(value, code) { if (!value) throw new Error(code); }

/** A restarted process observes the durable receipt before considering a new submission. */
export async function oneTick({ token, environment, appPrivateKey, discover = readRecordedCloudTask, tick = runDirectRunner }) {
  const recorded = await discover({ token });
  if (recorded.state === 'hold') return { state: 'resumption-hold' };
  if (recorded.state === 'processing') return { state: 'waiting-actions' };
  if (recorded.state === 'sent') {
    if (!/^task_[a-zA-Z0-9_-]+$/.test(recorded.task_id ?? '')) return { state: 'resumption-hold' };
    return tick({ token, environment, appPrivateKey, expectedCloudTaskId: recorded.task_id });
  }
  if (recorded.state !== 'none') return { state: 'resumption-hold' };
  return tick({ token, environment, appPrivateKey });
}

/** Return only fixed result categories, never raw errors or Cloud content. */
export function safeRunnerResult(result, tickResult) {
  const state = STATES.has(tickResult?.state) ? tickResult.state : 'unconfirmed';
  const authLifecycle = result === 'cloud_list_ok' ? 'saved' : result === 'cloud_list_unconfirmed' ? 'tick_failed' : result;
  const limitReason = state === 'limits-hold' && ['limited', 'unknown', 'unavailable'].includes(tickResult?.reason) ? tickResult.reason : undefined;
  return { state: result === 'cloud_list_ok' ? state : 'hold', auth_lifecycle: authLifecycle, ...(result === 'cloud_list_ok' && limitReason ? { reason: limitReason } : {}) };
}

async function main() {
  ensure(process.env.GITHUB_REPOSITORY === REPO && ['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) && process.env.GITHUB_REF === 'refs/heads/main', 'untrusted_context');
  const appId = process.env.AIS_PR_WRITER_APP_ID, installation = process.env.AIS_PR_WRITER_INSTALLATION_ID;
  const repoId = Number(process.env.GITHUB_REPOSITORY_ID), runId = process.env.GITHUB_RUN_ID;
  const privateKey = process.env.AIS_PR_WRITER_PRIVATE_KEY, githubToken = process.env.GITHUB_TOKEN;
  const environment = process.env.AIS_CODEX_CLOUD_ENVIRONMENT;
  let seed = process.env.AIS_CODEX_AUTH_JSON, token, path, expectedSecretUpdate, tickResult;
  delete process.env.AIS_CODEX_AUTH_JSON;
  delete process.env.AIS_PR_WRITER_PRIVATE_KEY;
  delete process.env.GITHUB_TOKEN;
  ensure(/^[1-9]\d*$/.test(appId ?? '') && /^[1-9]\d*$/.test(installation ?? '') && /^[1-9]\d*$/.test(runId ?? '') && typeof githubToken === 'string' && Number.isSafeInteger(repoId) && repoId > 0 && typeof privateKey === 'string' && typeof seed === 'string' && seed.length > 0, 'missing_configuration');
  ensure(/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/.test(environment ?? ''), 'missing_cloud_environment');
  const request = async (method, url, bearer, body) => {
    const response = await fetch(`https://api.github.com${url}`, { method, headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
    ensure(response.ok, 'github_request_failed');
    return response.status === 204 ? null : response.json();
  };
  const result = await maintainAuth({
    prepare: async () => {
      const key = createPrivateKey(privateKey); ensure(key.asymmetricKeyType === 'rsa', 'invalid_key');
      const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
      const issued = Math.floor(Date.now() / 1000);
      const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: issued - 30, exp: issued + 540, iss: appId })}`;
      const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
      const grant = await request('POST', `/app/installations/${installation}/access_tokens`, jwt, { repository_ids: [repoId], permissions: { secrets: 'write' } });
      token = grant?.token;
      ensure(typeof token === 'string' && token.length > 0 && grant.permissions?.secrets === 'write' && Object.entries(grant.permissions).every(([k, v]) => (k === 'secrets' && v === 'write') || (k === 'metadata' && v === 'read')) && grant.repositories?.length === 1 && grant.repositories[0].id === repoId && grant.repositories[0].full_name === REPO, 'invalid_app_grant');
      const metadata = await request('GET', `/repos/${REPO}/actions/secrets/${SECRET}`, token);
      const run = await request('GET', `/repos/${REPO}/actions/runs/${runId}`, githubToken);
      ensure(run?.event === process.env.GITHUB_EVENT_NAME && run?.head_branch === 'main' && seedPredatesRun(metadata?.updated_at, run?.created_at), 'stale_queued_secret');
      expectedSecretUpdate = metadata.updated_at;
      const directory = join(homedir(), '.codex'); await mkdir(directory, { recursive: true, mode: 0o700 });
      const candidate = join(directory, 'auth.json'); const file = await open(candidate, 'wx', 0o600); path = candidate;
      try { await file.writeFile(seed); } finally { await file.close(); seed = undefined; }
    },
    probe: async () => {
      tickResult = await oneTick({ token: githubToken, environment, appPrivateKey: privateKey });
      return tickResult && !tickResult.credential_cleanup;
    },
    persist: async () => {
      const metadata = await request('GET', `/repos/${REPO}/actions/secrets/${SECRET}`, token);
      ensure(metadata?.updated_at === expectedSecretUpdate, 'secret_changed');
      await storeSecret(path, token);
    },
    cleanup: async () => {
      let failed = false;
      if (path) try { await rm(path, { force: true }); } catch { failed = true; }
      if (token) try { await request('DELETE', '/installation/token', token); } catch { failed = true; }
      if (failed) throw new Error('cleanup_failed');
    },
  });
  console.log(JSON.stringify(safeRunnerResult(result, tickResult)));
  if (result !== 'cloud_list_ok') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'configuration_or_runtime_unavailable' })); process.exitCode = 1; });
