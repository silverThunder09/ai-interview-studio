/** A single, explicit tick using a clean checkout of the current trusted main. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AppCredentials, ProductWriter } from './pr-writer.mjs';
import { allPages } from './event-worker.ts';
import { REPO, RuntimeAPI, LoopStore, appendApprovedTasks, parseLoopConfig } from './loop-coordinator.mjs';
import { runDirectTick, validateDirectContext } from './direct-tick.mjs';
import { readActionsWriterEvidence } from './actions-writer-evidence.mjs';

const exec = promisify(execFile), SHA = /^[a-f0-9]{40}$/, ENV = /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$/;
function ensure(value, code) { if (!value) throw new Error(code); }
async function git(args) { return (await exec('git', args, { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim(); }

export function recordedCloudTask(state) {
  const task = state.tasks.find(t => t.phase !== 'completed');
  if (task && ['apply', 'ci', 'review', 'merge', 'main-ci'].includes(task.phase)) return { state: 'processing' };
  if (!task?.direct_cloud) return { state: 'none' };
  if (task.phase !== 'development' || task.direct_cloud.phase !== 'sent') return { state: 'hold' };
  return { state: 'sent', task_id: task.direct_cloud.task_id };
}

/** Discover only a receipt in the trusted journal after a process restart. */
export async function readRecordedCloudTask({ token, root = process.cwd() }) {
  ensure(typeof token === 'string' && token.length > 0, 'missing_runner_context');
  const rootPath = await realpath(root), gitRoot = await realpath(await git(['rev-parse', '--show-toplevel']));
  ensure(rootPath === gitRoot && await realpath(process.cwd()) === rootPath, 'wrong_runner_directory');
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  ensure(SHA.test(head) && (await git(['status', '--porcelain=v1', '--untracked-files=no'])) === '', 'untrusted_runner_checkout');
  const api = new RuntimeAPI(token);
  ensure((await api.repository())?.full_name === REPO && (await api.request('GET', '/branches/main')).commit.sha === head, 'trusted_main_moved');
  const config = parseLoopConfig(JSON.parse(await readFile('.github/approved-loop.json', 'utf8')));
  // Read an approved appended suffix without writing it; the ordinary runner
  // performs the guarded append only after recovery has ruled out a receipt.
  const state = appendApprovedTasks((await new LoopStore(api, config).readSnapshot()).state, config);
  ensure((await api.request('GET', '/branches/main')).commit.sha === head, 'trusted_main_moved');
  return recordedCloudTask(state);
}

/** No checkout or token manipulation; fail closed if local main is not trusted. */
export async function runDirectRunner({ token, environment, root = process.cwd(), expectedRequestKey, expectedCloudTaskId }) {
  ensure(typeof token === 'string' && token.length > 0 && ENV.test(environment ?? ''), 'missing_runner_context');
  const rootPath = await realpath(root), gitRoot = await realpath(await git(['rev-parse', '--show-toplevel']));
  ensure(rootPath === gitRoot && await realpath(process.cwd()) === rootPath, 'wrong_runner_directory');
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  ensure(SHA.test(head) && (await git(['status', '--porcelain=v1', '--untracked-files=no'])) === '', 'untrusted_runner_checkout');
  const api = new RuntimeAPI(token), repository = await api.repository();
  ensure(repository?.full_name === REPO && (await api.request('GET', '/branches/main')).commit.sha === head, 'trusted_main_moved');
  const config = parseLoopConfig(JSON.parse(await readFile('.github/approved-loop.json', 'utf8')));
  const policy = JSON.parse(await readFile('.github/review-policy.json', 'utf8'));
  validateDirectContext(config, policy);
  const labels = await allPages(api, '/issues/35/labels');
  ensure(labels.every(label => label && typeof label.name === 'string') && !labels.some(label => ['agent-paused', 'needs-user'].includes(label.name)), 'loop_control_paused');
  // This only appends a trusted-main suffix to an unlocked, completed queue;
  // the store preserves every previous task and uses a Git ref CAS.
  const store = new LoopStore(api, config);
  ensure((await api.request('GET', '/branches/main')).commit.sha === head, 'trusted_main_moved');
  // A capacity wait may only revisit its exact untouched request. Do not append
  // a queue suffix while resuming: even a concurrent queue change must hold.
  if (expectedRequestKey === undefined && expectedCloudTaskId === undefined) await store.appendApprovedTasks();
  // The default GitHub Actions masker prints its argument as a workflow
  // directive. A standalone runner must never print a private key or token.
  const credentials = new AppCredentials({ api, appId: process.env.AIS_PR_WRITER_APP_ID, installationId: process.env.AIS_PR_WRITER_INSTALLATION_ID, privateKey: process.env.AIS_PR_WRITER_PRIVATE_KEY, redact: () => {} });
  let result, cleanupFailed = false;
  try {
    const writer = config.pr_auth === 'github-app' ? new ProductWriter({ api, credentials, config }) : undefined;
    result = await runDirectTick({ api, store, config, policy, writer, environment, expectedRequestKey, expectedCloudTaskId,
      cloud: { actionsWriterReady: async () => (await readActionsWriterEvidence({ api, main: head })).state === 'ready' } });
  } finally {
    try { await credentials.dispose(); } catch { cleanupFailed = true; }
  }
  if (!cleanupFailed && result.state === 'writer-hold') {
    // Evidence from a separate job is informational until the result handoff
    // is implemented; it must never turn a hold into submission permission.
    try { result.actions_writer = await readActionsWriterEvidence({ api, main: head }); }
    catch { result.actions_writer = { state: 'hold', reason: 'proof_unavailable' }; }
  }
  return cleanupFailed ? { ...result, credential_cleanup: 'unconfirmed' } : result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--env') { console.error('Usage: node scripts/review/direct-runner.mjs --env ENV_ID'); process.exitCode = 2; }
  else runDirectRunner({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, environment: process.argv[3] })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ state: 'hold', reason: /^[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'runner_unavailable' })); process.exitCode = 1; });
}
