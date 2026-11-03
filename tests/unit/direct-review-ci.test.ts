import { describe, expect, it } from 'vitest';
import { reviewCIReady } from '../../scripts/review/loop-coordinator.mjs';

const repository = 'silverThunder09/ai-interview-studio', sha = (n: string) => n.repeat(40), contexts = ['checks', 'package', 'pr-policy'];
const paths = ['.github/workflows/ci.yml', '.github/workflows/windows-build.yml', '.github/workflows/pr-policy.yml'];
function fixture() {
  const policy = { required_checks: contexts }, definition = { pr: 80, allowed_paths: ['src/a.ts'] };
  const task = { pr: 80, head: sha('2'), base: sha('1'), checkout: sha('3'), validated_ci: contexts.map((context, i) => ({ repository, context, run_id: String(100 + i), pr_number: 80, head_sha: sha('2'), base_sha: sha('1'), checkout_sha: sha('3') })) };
  const pr = { state: 'open', merged: false, draft: false, merge_commit_sha: sha('3'), user: { login: 'silverThunder09' }, head: { sha: sha('2'), ref: 'work/a', repo: { full_name: repository, fork: false } }, base: { sha: sha('1'), ref: 'main', repo: { full_name: repository } } };
  const runs = contexts.map((_, i) => ({ id: 100 + i, run_attempt: 1, path: paths[i], event: 'pull_request', head_sha: sha('2'), repository: { full_name: repository }, head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' }));
  const checks = contexts.map((name, i) => ({ id: 200 + i, name, head_sha: sha('2'), app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', details_url: `https://github.com/${repository}/actions/runs/${100 + i}/job/${300 + i}` }));
  const step = { name: 'Record tested head and base', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:01Z', completed_at: '2026-10-20T10:00:02Z' };
  const commit = { sha: sha('3'), parents: [{ sha: sha('1') }, { sha: sha('2') }] };
  const api = { async request(_method: string, path: string): Promise<unknown> {
    if (path.startsWith('/issues/')) return [];
    if (path.startsWith('/pulls/80/files')) return [{ filename: 'src/a.ts', status: 'modified' }];
    if (path === '/pulls/80') return pr;
    if (path === '/branches/main') return { commit: { sha: sha('1') } };
    if (path === `/git/commits/${sha('3')}`) return commit;
    if (path.startsWith('/commits/')) return { check_runs: checks };
    const m = path.match(/^\/actions\/runs\/(\d+)$/); if (m) return runs[Number(m[1]) - 100];
    throw new Error('unexpected_request');
  }, async pagesObject(path: string): Promise<unknown[]> {
    if (path.startsWith('/actions/runs?')) return runs;
    const m = path.match(/^\/actions\/runs\/(\d+)\/attempts\/1\/jobs$/); if (!m) throw new Error('unexpected_request');
    const i = Number(m[1]) - 100; return [{ id: 300 + i, run_id: 100 + i, run_attempt: 1, name: contexts[i], status: 'completed', conclusion: 'success', steps: [step] }];
  }, async jobLog(id: number) {
    const proof = task.validated_ci[id - 300];
    return ['##[group]Run node scripts/review/ci-evidence.mjs', 'node scripts/review/ci-evidence.mjs', '##[endgroup]', `AIS_CI_EVIDENCE ${JSON.stringify(proof)}`].map(x => `2026-10-20T10:00:01.500Z ${x}`).join('\n');
  } };
  return { api, task, definition, policy, pr, runs, checks, commit };
}
describe('review CI preflight', () => {
  it('requires the current merge commit and each latest successful native job log', async () => {
    const f = fixture(); expect(await reviewCIReady(f.api, f.task, f.definition, f.policy)).toBe(true);
    f.commit.parents[1]!.sha = sha('4'); await expect(reviewCIReady(f.api, f.task, f.definition, f.policy)).rejects.toThrow('stale_review_ci');
  });
  it('holds pending and failed current checks instead of using prior success', async () => {
    const f = fixture(); f.runs[1]!.status = 'in_progress'; f.runs[1]!.conclusion = '';
    expect(await reviewCIReady(f.api, f.task, f.definition, f.policy)).toBe(false);
    f.runs[1]!.status = 'completed'; f.runs[1]!.conclusion = 'failure';
    await expect(reviewCIReady(f.api, f.task, f.definition, f.policy)).rejects.toThrow('native_ci_failed');
  });
  it('rejects a changed proof, untrusted log or a changed PR while gathering evidence', async () => {
    const f = fixture(); f.task.validated_ci[0]!.run_id = '999';
    await expect(reviewCIReady(f.api, f.task, f.definition, f.policy)).rejects.toThrow();
    const bad = fixture(); bad.api.jobLog = async () => 'not a CI proof';
    await expect(reviewCIReady(bad.api, bad.task, bad.definition, bad.policy)).rejects.toThrow();
    const moved = fixture(), log = moved.api.jobLog;
    moved.api.jobLog = async id => { const result = await log(id); moved.pr.head.sha = sha('4'); return result; };
    await expect(reviewCIReady(moved.api, moved.task, moved.definition, moved.policy)).rejects.toThrow('stale_review_ci');
  });
});
