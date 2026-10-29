/** Read-only, current-main evidence for the existing GitHub Actions App probe. */
import { REPO } from './loop-coordinator.mjs';
const SHA = /^[a-f0-9]{40}$/, WORKFLOW = '.github/workflows/writer-readiness.yml';
const STEP = 'Check existing App access and revoke the temporary token';
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b, fields) => fields.every(field => a?.[field] === b?.[field]);

/** Advisory evidence only. It does not authorize Cloud submission or product writes. */
export async function readActionsWriterEvidence({ api, main }) {
  if (!SHA.test(main ?? '') || (await api.request('GET', '/branches/main'))?.commit?.sha !== main) return { state: 'hold', reason: 'main_changed' };
  const runs = await api.pagesObject('/actions/workflows/writer-readiness.yml/runs?event=workflow_dispatch&branch=main', 'workflow_runs');
  const candidates = runs.filter(r => r?.head_sha === main && r.path === WORKFLOW && r.event === 'workflow_dispatch' && r.head_branch === 'main' && r.repository?.full_name === REPO && r.head_repository?.full_name === REPO);
  if (!candidates.length) return { state: 'hold', reason: 'no_current_probe' };
  if (candidates.some(r => !positive(r.id) || !positive(r.run_attempt) || !Number.isFinite(Date.parse(r.updated_at ?? ''))) || new Set(candidates.map(r => r.id)).size !== candidates.length) return { state: 'hold', reason: 'incomplete_probe' };
  candidates.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
  const selected = candidates[0], fresh = await api.request('GET', `/actions/runs/${selected.id}`);
  if (!same(fresh, selected, ['id', 'path', 'event', 'head_sha', 'head_branch', 'run_attempt', 'updated_at']) || fresh.repository?.full_name !== REPO || fresh.head_repository?.full_name !== REPO) return { state: 'hold', reason: 'probe_changed' };
  if (fresh.status !== 'completed' || fresh.conclusion !== 'success') return { state: 'hold', reason: 'probe_not_successful' };
  const jobs = await api.pagesObject(`/actions/runs/${selected.id}/attempts/${selected.run_attempt}/jobs`, 'jobs');
  const matches = jobs.filter(j => j?.name === 'readiness');
  if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success' || matches[0].run_attempt !== selected.run_attempt || !Array.isArray(matches[0].steps)) return { state: 'hold', reason: 'invalid_probe_job' };
  const steps = matches[0].steps.filter(s => s?.name === STEP);
  if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') return { state: 'hold', reason: 'invalid_probe_step' };
  if ((await api.request('GET', '/branches/main'))?.commit?.sha !== main) return { state: 'hold', reason: 'main_changed' };
  return { state: 'ready', run_id: selected.id };
}
