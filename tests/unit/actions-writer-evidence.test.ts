import { describe, expect, it } from 'vitest';
import { readActionsWriterEvidence } from '../../scripts/review/actions-writer-evidence.mjs';

const repo = 'silverThunder09/ai-interview-studio', main = 'a'.repeat(40);
const probe = () => ({ id: 100, path: '.github/workflows/writer-readiness.yml', event: 'workflow_dispatch', head_sha: main, head_branch: 'main', run_attempt: 1, updated_at: '2026-10-30T00:00:00Z', status: 'completed', conclusion: 'success', repository: { full_name: repo }, head_repository: { full_name: repo } });
const step = () => ({ name: 'Check existing App access and revoke the temporary token', status: 'completed', conclusion: 'success' });
function fixture() {
  const run = probe(); let runs = [run], live = run, branch = main, jobs = [{ name: 'readiness', status: 'completed', conclusion: 'success', run_attempt: 1, steps: [step()] }];
  const api = { async request(_method: string, path: string): Promise<unknown> { if (path === '/branches/main') return { commit: { sha: branch } }; if (path === `/actions/runs/${live.id}`) return live; throw new Error('unexpected'); },
    async pagesObject(path: string) { if (path.startsWith('/actions/workflows/')) return runs; if (path.includes('/jobs')) return jobs; throw new Error('unexpected'); } };
  return { api, run, setRuns: (value: typeof runs) => { runs = value; }, setLive: (value: typeof live) => { live = value; }, setBranch: (value: string) => { branch = value; }, setJobs: (value: typeof jobs) => { jobs = value; } };
}
describe('GitHub Actions writer readiness evidence', () => {
  it('accepts only the current main successful workflow and its exact token cleanup step', async () => {
    const f = fixture(); await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toEqual({ state: 'ready', run_id: 100 });
  });
  it('holds for stale main, unknown workflow, duplicate records or changed attempts', async () => {
    const f = fixture(); f.setBranch('b'.repeat(40));
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'main_changed' });
    f.setBranch(main); f.setRuns([{ ...f.run, path: '.github/workflows/other.yml' }]);
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'no_current_probe' });
    f.setRuns([f.run, f.run]);
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'incomplete_probe' });
    f.setRuns([f.run]); f.setLive({ ...f.run, run_attempt: 2 });
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'probe_changed' });
  });
  it('does not use an older success to hide a newer failed attempt', async () => {
    const f = fixture(); const latest = { ...f.run, id: 101, status: 'completed', conclusion: 'failure', updated_at: '2026-10-30T01:00:00Z' };
    f.setRuns([f.run, latest]); f.setLive(latest);
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'probe_not_successful' });
  });
  it('rejects incomplete jobs, missing revocation or duplicate steps', async () => {
    const f = fixture();
    f.setJobs([{ name: 'readiness', status: 'completed', conclusion: 'success', run_attempt: 1, steps: [] }]);
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'invalid_probe_step' });
    f.setJobs([{ name: 'readiness', status: 'completed', conclusion: 'success', run_attempt: 1, steps: [step(), step()] }]);
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'invalid_probe_step' });
    f.setJobs([{ name: 'readiness', status: 'completed', conclusion: 'success', run_attempt: 2, steps: [step()] }]);
    await expect(readActionsWriterEvidence({ api: f.api, main })).resolves.toMatchObject({ state: 'hold', reason: 'invalid_probe_job' });
  });
});
