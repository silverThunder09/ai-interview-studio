/** Distinct diagnostic: never receives Codex login data, starts Codex, or writes a Secret. */
/* global fetch, AbortSignal */
import { createPrivateKey, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, open, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'silverThunder09/ai-interview-studio';
const SECRET = 'AIS_CODEX_AUTH_JSON';
const FAILED_RUN = 41282038792;
const positive = value => /^[1-9][0-9]*$/.test(String(value ?? ''));
const HTTP_CODES = new Set([401, 403, 404, 409, 422, 429]);
export class DiagnosticError extends Error {
  constructor(code) { super('diagnostic_failed'); this.code = code; }
}
const safeFailure = error => error instanceof DiagnosticError && /^(missing_config|invalid_key|http_(401|403|404|409|422|429|5xx|other)|network_error|invalid_grant|invalid_metadata|file_error|revoke_error)$/.test(error.code) ? error.code : 'unclassified';
const requireValue = (value, code) => { if (!value) throw new DiagnosticError(code); };

/** Dependencies return no credential values in results. Independent file check still runs on App failure. */
export async function diagnose({ config, grant, metadata, failedRun, fileCheck, revoke }) {
  const stages = {};
  let token;
  try {
    try { await config(); stages.configuration = 'ok'; }
    catch (error) { stages.configuration = safeFailure(error); }
    if (stages.configuration === 'ok') {
      try { token = await grant(); stages.app_permission = 'ok'; }
      catch (error) { stages.app_permission = safeFailure(error); }
      if (token) {
        try {
          const secret = await metadata(token);
          stages.secret_metadata = 'ok';
          try {
            const run = await failedRun();
            const updated = Date.parse(secret.updated_at), started = Date.parse(run.created_at);
            if (!Number.isFinite(updated) || !Number.isFinite(started)) stages.historical_snapshot = 'unavailable';
            else stages.historical_snapshot = updated < started ? 'current_metadata_precedes_run' : 'changed_or_same_second';
          } catch { stages.historical_snapshot = 'unavailable'; }
        } catch (error) { stages.secret_metadata = safeFailure(error); }
      } else stages.secret_metadata = 'not_checked';
    } else { stages.app_permission = 'not_checked'; stages.secret_metadata = 'not_checked'; }
    try { await fileCheck(); stages.empty_file = 'ok'; }
    catch (error) { stages.empty_file = safeFailure(error); }
  } finally {
    if (token) {
      try { await revoke(token); stages.token_cleanup = 'ok'; }
      catch { stages.token_cleanup = 'revoke_error'; }
    } else stages.token_cleanup = stages.app_permission === 'revoke_error' ? 'revoke_error' : 'not_needed';
  }
  return stages;
}

async function main() {
  requireValue(process.env.GITHUB_REPOSITORY === REPO && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === 'refs/heads/main', 'missing_config');
  const appId = process.env.AIS_PR_WRITER_APP_ID, installationId = process.env.AIS_PR_WRITER_INSTALLATION_ID;
  const repoId = Number(process.env.GITHUB_REPOSITORY_ID), privateKey = process.env.AIS_PR_WRITER_PRIVATE_KEY;
  const workflowToken = process.env.GITHUB_TOKEN;
  delete process.env.AIS_PR_WRITER_PRIVATE_KEY;
  let activeToken;
  async function request(method, path, token, body) {
    let response;
    try { response = await fetch(`https://api.github.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new DiagnosticError('network_error'); }
    if (!response.ok) throw new DiagnosticError(`http_${HTTP_CODES.has(response.status) ? response.status : response.status >= 500 && response.status <= 599 ? '5xx' : 'other'}`);
    return response.status === 204 ? null : response.json();
  }
  const result = await diagnose({
    config: async () => requireValue(positive(appId) && positive(installationId) && Number.isSafeInteger(repoId) && repoId > 0 && typeof privateKey === 'string' && privateKey.length > 0 && typeof workflowToken === 'string' && workflowToken.length > 0, 'missing_config'),
    grant: async () => {
      let key;
      try { key = createPrivateKey(privateKey); requireValue(key.asymmetricKeyType === 'rsa', 'invalid_key'); }
      catch { throw new DiagnosticError('invalid_key'); }
      const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const issued = Math.floor(Date.now() / 1000);
      const payload = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iat: issued - 30, exp: issued + 540, iss: appId })}`;
      const jwt = `${payload}.${sign('RSA-SHA256', Buffer.from(payload), key).toString('base64url')}`;
      const response = await request('POST', `/app/installations/${installationId}/access_tokens`, jwt, { repository_ids: [repoId], permissions: { secrets: 'write' } });
      activeToken = response?.token;
      try {
        requireValue(typeof activeToken === 'string' && activeToken.length > 0 && response.permissions?.secrets === 'write' && Object.entries(response.permissions).every(([k,v]) => (k === 'secrets' && v === 'write') || (k === 'metadata' && v === 'read')) && response.repositories?.length === 1 && response.repositories[0].id === repoId && response.repositories[0].full_name === REPO, 'invalid_grant');
      } catch (error) {
        if (activeToken) { try { await request('DELETE', '/installation/token', activeToken); activeToken = undefined; } catch { throw new DiagnosticError('revoke_error'); } }
        throw error;
      }
      return activeToken;
    },
    metadata: async token => {
      const response = await request('GET', `/repos/${REPO}/actions/secrets/${SECRET}`, token);
      requireValue(response?.name === SECRET && typeof response.updated_at === 'string', 'invalid_metadata');
      return { updated_at: response.updated_at };
    },
    failedRun: () => request('GET', `/repos/${REPO}/actions/runs/${FAILED_RUN}`, workflowToken),
    fileCheck: async () => {
      const directory = join(homedir(), '.codex');
      let created = false, failed = false;
      const path = join(directory, 'auth.json');
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const handle = await open(path, 'wx', 0o600); created = true;
        await handle.close();
      } catch { failed = true; }
      if (created) try { await rm(path); } catch { failed = true; }
      if (failed) throw new DiagnosticError('file_error');
    },
    revoke: token => request('DELETE', '/installation/token', token)
  });
  console.log(JSON.stringify({ stages: result }));
  if (Object.values(result).some(value => !['ok', 'not_needed', 'not_checked', 'unavailable', 'current_metadata_precedes_run', 'changed_or_same_second'].includes(value))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'diagnostic_unavailable' })); process.exitCode = 1; });
