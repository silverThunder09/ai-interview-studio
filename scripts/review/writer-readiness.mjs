/** Explicit read-only readiness check for the existing repository-scoped App. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { AppCredentials } from './pr-writer.mjs';
import { REPO, RuntimeAPI } from './loop-coordinator.mjs';

const exec = promisify(execFile), SHA = /^[a-f0-9]{40}$/;
const reasons = new Set(['missing_pr_writer_app', 'trusted_main_moved', 'untrusted_probe_context', 'app_network_failed', 'app_auth_http_failed', 'invalid_app_key', 'invalid_app_token', 'overbroad_or_invalid_app_token', 'wrong_app_repository', 'app_token_expired']);
const safeReason = e => reasons.has(e?.message) ? e.message : 'writer_unavailable';

/** No product, state, PR, issue or workflow write is performed. */
export async function probeWriter({ credentials, checkMain }) {
  let failure;
  try { await checkMain(); await credentials.client(); await checkMain(); }
  catch (error) { failure = safeReason(error); }
  try { await credentials.dispose(); } catch { return { state: 'hold', reason: 'credential_cleanup_unconfirmed' }; }
  return failure ? { state: 'hold', reason: failure } : { state: 'ready' };
}

async function main() {
  const token = process.env.GITHUB_TOKEN, expected = process.env.GITHUB_SHA;
  if (!token || !SHA.test(expected ?? '') || process.env.GITHUB_REPOSITORY !== REPO || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('untrusted_probe_context');
  const api = new RuntimeAPI(token);
  const checkMain = async () => {
    const local = (await exec('git', ['rev-parse', 'HEAD'], { timeout: 15000 })).stdout.trim();
    const repo = await api.repository(), main = await api.request('GET', '/branches/main');
    if (local !== expected || repo?.full_name !== REPO || main?.commit?.sha !== expected) throw new Error('trusted_main_moved');
  };
  const credentials = new AppCredentials({ api, appId: process.env.AIS_PR_WRITER_APP_ID, installationId: process.env.AIS_PR_WRITER_INSTALLATION_ID, privateKey: process.env.AIS_PR_WRITER_PRIVATE_KEY, redact: () => {} });
  const result = await probeWriter({ credentials, checkMain });
  console.log(JSON.stringify(result));
  if (result.state !== 'ready') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(JSON.stringify({ state: 'hold', reason: safeReason(error) })); process.exitCode = 1; });
