/** Read a trusted-main Actions proof without downloading job logs in Cloud. */
import { REPO } from './loop-coordinator.mjs';
import { selectNativeMainRun } from './main-ci-proof.mjs';
const SHA = /^[a-f0-9]{40}$/, PATH = '.github/workflows/main-ci-readiness.yml';
const STEP = 'Verify current main CI and checkout';
const positive = n => Number.isSafeInteger(n) && n > 0;

export async function readActionsMainCIEvidence({ api, main }) {
  if (!SHA.test(main ?? '') || (await api.request('GET', '/branches/main'))?.commit?.sha !== main) return { state: 'hold', reason: 'main_changed' };
  const list = () => api.pagesObject('/actions/workflows/main-ci-readiness.yml/runs?branch=main', 'workflow_runs');
  const select = runs => {
    const candidates = runs.filter(r => r.head_sha === main && r.path === PATH && ['workflow_run', 'workflow_dispatch'].includes(r.event) && r.head_branch === 'main' && r.repository?.full_name === REPO && r.head_repository?.full_name === REPO);
    if (!candidates.length || candidates.some(r => !positive(r.id) || !positive(r.run_attempt) || !Number.isFinite(Date.parse(r.updated_at)))) return null;
    return candidates.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id)[0];
  };
  const selected = select(await list());
  if (!selected) return { state: 'hold', reason: 'proof_missing' };
  if (!Number.isFinite(Date.parse(selected.created_at))) return { state: 'hold', reason: 'invalid_proof_time' };
  const native = () => api.pagesObject(`/actions/runs?event=push&branch=main&head_sha=${main}`, 'workflow_runs');
  const nativeRuns = await native();
  try {
    for (const path of ['.github/workflows/ci.yml', '.github/workflows/windows-build.yml']) {
      const run = selectNativeMainRun(nativeRuns, path, main);
      if (run.status !== 'completed' || run.conclusion !== 'success' || Date.parse(run.updated_at) > Date.parse(selected.created_at)) return { state: 'hold', reason: 'native_ci_newer_or_failed' };
    }
  } catch { return { state: 'hold', reason: 'native_ci_missing' }; }
  const fresh = await api.request('GET', `/actions/runs/${selected.id}`);
  if (!['id', 'path', 'event', 'head_sha', 'head_branch', 'run_attempt', 'created_at', 'updated_at'].every(k => fresh?.[k] === selected[k]) || fresh.repository?.full_name !== REPO || fresh.head_repository?.full_name !== REPO || fresh.status !== 'completed' || fresh.conclusion !== 'success') return { state: 'hold', reason: 'proof_not_successful' };
  const jobs = await api.pagesObject(`/actions/runs/${fresh.id}/attempts/${fresh.run_attempt}/jobs`, 'jobs');
  const matching = jobs.filter(job => job.name === 'readiness');
  if (matching.length !== 1 || matching[0].run_id !== fresh.id || matching[0].run_attempt !== fresh.run_attempt || matching[0].status !== 'completed' || matching[0].conclusion !== 'success' || !Array.isArray(matching[0].steps)) return { state: 'hold', reason: 'invalid_proof_job' };
  const steps = matching[0].steps.filter(step => step.name === STEP);
  if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') return { state: 'hold', reason: 'invalid_proof_step' };
  const last = select(await list());
  const nativeAfter = await native();
  try {
    for (const path of ['.github/workflows/ci.yml', '.github/workflows/windows-build.yml']) {
      const before = selectNativeMainRun(nativeRuns, path, main), after = selectNativeMainRun(nativeAfter, path, main);
      if (['id', 'run_attempt', 'updated_at', 'status', 'conclusion'].some(k => before[k] !== after[k])) return { state: 'hold', reason: 'proof_changed' };
    }
  } catch { return { state: 'hold', reason: 'proof_changed' }; }
  if (!last || ['id', 'run_attempt', 'updated_at'].some(k => last[k] !== selected[k]) || (await api.request('GET', '/branches/main'))?.commit?.sha !== main) return { state: 'hold', reason: 'proof_changed' };
  return { state: 'ready', run_id: selected.id };
}
