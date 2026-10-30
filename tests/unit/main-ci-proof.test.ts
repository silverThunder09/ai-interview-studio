import { describe, expect, it } from 'vitest';
import { mainCIFailure, verifyNativeMainCI } from '../../scripts/review/main-ci-proof.mjs';
import { APIError } from '../../scripts/review/event-worker';
import { readActionsMainCIEvidence } from '../../scripts/review/actions-main-ci-evidence.mjs';

const repo = 'silverThunder09/ai-interview-studio', sha = 'a'.repeat(40);
const checkout = 'Run actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
const native = (id: number, path: string) => ({ id, path, event: 'push', head_sha: sha, head_branch: 'main', run_attempt: 1, updated_at: '2026-10-30T00:00:00Z', status: 'completed', conclusion: 'success', repository: { full_name: repo }, head_repository: { full_name: repo } });
function fixture() {
  const runs = [native(11, '.github/workflows/ci.yml'), native(12, '.github/workflows/windows-build.yml')];
  const proof = { id: 20, path: '.github/workflows/main-ci-readiness.yml', event: 'workflow_run', head_sha: sha, head_branch: 'main', run_attempt: 1, created_at: '2026-10-30T00:01:00Z', updated_at: '2026-10-30T00:02:00Z', status: 'completed', conclusion: 'success', repository: { full_name: repo }, head_repository: { full_name: repo } };
  const proofs = [proof];
  let main = sha, commandSha = sha;
  const api = {
    async request(_method: string, path: string) {
      if (path === '/branches/main') return { commit: { sha: main } };
      const proofRun = proofs.find(r => path === `/actions/runs/${r.id}`);
      if (proofRun) return structuredClone(proofRun);
      const run = runs.find(r => path === `/actions/runs/${r.id}`);
      if (run) return structuredClone(run);
      throw new Error('unexpected_request');
    },
    async pagesObject(path: string) {
      if (path.startsWith('/actions/workflows/main-ci-readiness.yml/runs')) return structuredClone(proofs);
      if (path.startsWith('/actions/runs?')) return structuredClone(runs);
      if (path.startsWith('/actions/runs/20/')) return [{ name: 'readiness', run_id: 20, run_attempt: 1, status: 'completed', conclusion: 'success', steps: [{ name: 'Verify current main CI and checkout', status: 'completed', conclusion: 'success' }] }];
      const id = Number(path.match(/^\/actions\/runs\/(\d+)/)?.[1]);
      if (id === 11 || id === 12) return [{ id: id + 100, name: id === 11 ? 'checks' : 'package', run_id: id, run_attempt: 1, status: 'completed', conclusion: 'success', steps: [{ name: checkout, status: 'completed', conclusion: 'success', started_at: '2026-10-30T00:00:00Z', completed_at: '2026-10-30T00:00:03Z' }] }];
      throw new Error('unexpected_jobs');
    },
    async jobLog(id: number) {
      const command = id === 111 ? '/usr/bin/git' : '"C:\\Program Files\\Git\\bin\\git.exe"';
      const newline = id === 111 ? '\n' : '\r\n';
      return [`2026-10-30T00:00:01Z [command]${command} log -1 --format=%H`, `2026-10-30T00:00:02Z ${commandSha}`, ''].join(newline);
    },
  };
  return { api, runs, proof, proofs, setMain: (value: string) => { main = value; }, setCheckout: (value: string) => { commandSha = value; } };
}

describe('current main CI proof', () => {
  it('records only safe classified failures without changing the hold decision', () => {
    expect(mainCIFailure(new Error('main_checkout_missing'))).toEqual({ state: 'hold', reason: 'main_ci_unavailable', detail: 'main_checkout_missing' });
    expect(mainCIFailure(new APIError(502, 'GET /synthetic-private-path'))).toEqual({ state: 'hold', reason: 'main_ci_unavailable', detail: 'github_http_502' });
    expect(mainCIFailure(new Error('synthetic-secret and private URL'))).toEqual({ state: 'hold', reason: 'main_ci_unavailable', detail: 'unclassified' });
    expect(mainCIFailure(null)).toEqual({ state: 'hold', reason: 'main_ci_unavailable', detail: 'unclassified' });
  });
  it('ignores only completed skipped workflow-run proofs while still checking latest native CI', async () => {
    const f = fixture();
    const skipped = { ...f.proof, id: 21, conclusion: 'skipped', updated_at: '2026-10-30T00:04:00Z' };
    f.proofs.push(skipped);
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toEqual({ state: 'ready', run_id: 20 });
    f.runs.push({ ...native(13, '.github/workflows/ci.yml'), conclusion: 'failure', updated_at: '2026-10-30T00:03:00Z' });
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toMatchObject({ state: 'hold' });
  });
  it('does not ignore a newer failed, cancelled, running, or manually skipped proof', async () => {
    for (const changed of [{ conclusion: 'failure' }, { conclusion: 'cancelled' }, { status: 'in_progress', conclusion: null }, { event: 'workflow_dispatch', conclusion: 'skipped' }]) {
      const f = fixture();
      f.proofs.push({ ...f.proof, ...changed, id: 21, updated_at: '2026-10-30T00:04:00Z' } as typeof f.proof);
      expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toMatchObject({ state: 'hold', reason: 'proof_not_successful' });
    }
  });
  it('verifies both native push jobs and their checkout, then reads the Actions proof', async () => {
    const f = fixture();
    expect(await verifyNativeMainCI({ api: f.api, main: sha })).toEqual({ state: 'ready' });
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toEqual({ state: 'ready', run_id: 20 });
  });
  it('rejects a checkout for a different commit', async () => {
    const f = fixture(); f.setCheckout('b'.repeat(40));
    await expect(verifyNativeMainCI({ api: f.api, main: sha })).rejects.toThrow('main_checkout_unproven');
  });
  it('rejects a later failed native run even after a successful proof', async () => {
    const f = fixture(); f.runs.push({ ...native(13, '.github/workflows/ci.yml'), conclusion: 'failure', updated_at: '2026-10-30T00:03:00Z' });
    await expect(verifyNativeMainCI({ api: f.api, main: sha })).rejects.toThrow('main_ci_not_successful');
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toMatchObject({ state: 'hold' });
  });
  it('does not ignore a newer manually dispatched failed main check', async () => {
    const f = fixture(); f.runs.push({ ...native(13, '.github/workflows/ci.yml'), event: 'workflow_dispatch', conclusion: 'failure', updated_at: '2026-10-30T00:03:00Z' });
    await expect(verifyNativeMainCI({ api: f.api, main: sha })).rejects.toThrow('main_ci_not_successful');
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toMatchObject({ state: 'hold' });
  });
  it('holds when a native rerun is newer than the proof or main changes', async () => {
    const f = fixture(); f.runs[0]!.updated_at = '2026-10-30T00:03:00Z';
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toMatchObject({ state: 'hold', reason: 'native_ci_newer_or_failed' });
    f.setMain('b'.repeat(40));
    expect(await readActionsMainCIEvidence({ api: f.api, main: sha })).toMatchObject({ state: 'hold', reason: 'main_changed' });
  });
});
