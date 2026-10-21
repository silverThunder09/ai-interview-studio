import { describe, expect, it } from 'vitest';
import { latestCheck, readAllReviews, readJobCIEvidence } from '../../scripts/review/ci-proof.mjs';

const repository = 'silverThunder09/ai-interview-studio';
function fixture() {
  const expected = { repository, context: 'checks', pr_number: 56, head_sha: '1'.repeat(40), base_sha: '2'.repeat(40), checkout_sha: '3'.repeat(40) };
  const proof = { ...expected, run_id: '100' };
  const check = { id: 200, name: 'checks', head_sha: expected.head_sha, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', details_url: `https://github.com/${repository}/actions/runs/100/job/300` };
  const run = { id: 100, run_attempt: 2, status: 'completed', conclusion: 'success', event: 'pull_request', head_sha: expected.head_sha, repository: { full_name: repository } };
  const step = { name: 'Record tested head and base', status: 'completed', conclusion: 'success', started_at: '2026-10-20T10:00:01Z', completed_at: '2026-10-20T10:00:02Z' };
  const job = { id: 300, run_id: 100, run_attempt: 2, name: 'checks', status: 'completed', conclusion: 'success', steps: [step] };
  const line = (s: string, time = '10:00:01.500') => `2026-10-20T${time}Z ${s}`;
  const log = [line('##[group]Run node scripts/review/ci-evidence.mjs'), line('node scripts/review/ci-evidence.mjs'), line(`PR_BODY: AIS_CI_EVIDENCE ${JSON.stringify(proof)}`), line('##[endgroup]'), line(`AIS_CI_EVIDENCE ${JSON.stringify(proof)}`), line('##[group]Post job cleanup', '10:00:03.000')].join('\n');
  return { expected, proof, check, run, job, step, line, log };
}
describe('actual successful CI stdout boundary', () => {
  it('binds the successful step, latest attempt, run, job, app and all commit identities', () => {
    const f = fixture(); expect(readJobCIEvidence(f.expected, [f.check], f.run, f.job, f.log)).toEqual(f.proof);
  });
  it('does not accept a proof printed only inside command/environment echo', () => {
    const f = fixture(); const log = f.log.replace(f.line(`AIS_CI_EVIDENCE ${JSON.stringify(f.proof)}`), '');
    expect(() => readJobCIEvidence(f.expected, [f.check], f.run, f.job, log)).toThrow('missing_or_noncanonical');
  });
  it('checks the last valid JSON rather than falling back to an earlier matching proof', () => {
    const f = fixture(); const extra = f.line(`AIS_CI_EVIDENCE ${JSON.stringify({ ...f.proof, head_sha: '4'.repeat(40) })}`);
    expect(() => readJobCIEvidence(f.expected, [f.check], f.run, f.job, f.log.replace(f.line('##[group]Post job cleanup', '10:00:03.000'), extra))).toThrow('stale_or_wrong');
    expect(readJobCIEvidence(f.expected, [f.check], f.run, f.job, f.log + '\n' + f.line('AIS_CI_EVIDENCE {broken}'))).toEqual(f.proof);
  });
  it('rejects duplicate keys, unknown fields and a marker substring', () => {
    const f = fixture(), original = JSON.stringify(f.proof);
    for (const replacement of [original.replace('{', '{"run_id":"100",'), JSON.stringify({ ...f.proof, trusted: true }), 'prefix ' + original]) {
      expect(() => readJobCIEvidence(f.expected, [f.check], f.run, f.job, f.log.replace(`AIS_CI_EVIDENCE ${original}`, `AIS_CI_EVIDENCE ${replacement}`).replace(`AIS_CI_EVIDENCE ${original}`, `AIS_CI_EVIDENCE ${replacement}`))).toThrow();
    }
  });
  it('rejects stale, unsuccessful or non-Actions checks without an older-success fallback', () => {
    const f = fixture();
    for (const changed of [{ head_sha: '4'.repeat(40) }, { app: { slug: 'other' } }, { conclusion: 'failure' }, { details_url: f.check.details_url + '/wrong' }]) {
      expect(() => readJobCIEvidence(f.expected, [f.check, { ...f.check, ...changed, id: 201 }], f.run, f.job, f.log)).toThrow();
    }
    expect(latestCheck([f.check, { ...f.check, id: 201 }], 'checks').id).toBe(201);
  });
  it('rejects an old job attempt, failed run, wrong repository and wrong job', () => {
    const f = fixture();
    for (const changed of [{ run_attempt: 1 }, { run_id: 99 }, { name: 'package' }, { conclusion: 'failure' }]) expect(() => readJobCIEvidence(f.expected, [f.check], f.run, { ...f.job, ...changed }, f.log)).toThrow();
    for (const changed of [{ conclusion: 'failure' }, { repository: { full_name: 'other/repository' } }, { head_sha: '4'.repeat(40) }]) expect(() => readJobCIEvidence(f.expected, [f.check], { ...f.run, ...changed }, f.job, f.log)).toThrow();
  });
  it('requires one successful named step and its actual command output in the step time interval', () => {
    const f = fixture();
    for (const steps of [[], [f.step, f.step], [{ ...f.step, conclusion: 'failure' }], [{ ...f.step, started_at: '2026-10-20T10:00:05Z', completed_at: '2026-10-20T10:00:06Z' }]]) expect(() => readJobCIEvidence(f.expected, [f.check], f.run, { ...f.job, steps }, f.log)).toThrow();
    for (const log of [f.log.replace('##[endgroup]', ''), f.log.replace('Run node scripts/review/ci-evidence.mjs', 'Run echo AIS_CI_EVIDENCE'), f.log + '\n' + f.line('##[group]Run node scripts/review/ci-evidence.mjs')]) expect(() => readJobCIEvidence(f.expected, [f.check], f.run, f.job, log)).toThrow();
  });
});
describe('raw REST review pagination', () => {
  it('passes every original state and page through without filtering', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, state: ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'PENDING', 'DISMISSED'][i % 5], user: { login: 'reviewer' } }));
    const last = [{ id: 101, state: 'CHANGES_REQUESTED', user: { login: 'another' } }], calls: string[] = [];
    const actual = await readAllReviews({ async request(method, path) { expect(method).toBe('GET'); calls.push(path); return calls.length === 1 ? first : last; } }, 56);
    expect(actual).toEqual([...first, ...last]); expect(actual[0]).toBe(first[0]);
    expect(calls).toEqual(['/pulls/56/reviews?per_page=100&page=1', '/pulls/56/reviews?per_page=100&page=2']);
  });
  it('does not treat HTTP errors or malformed/partial pages as an empty list', async () => {
    await expect(readAllReviews({ async request() { throw new Error('HTTP 403'); } }, 56)).rejects.toThrow('HTTP 403');
    await expect(readAllReviews({ async request() { return { reviews: [] }; } }, 56)).rejects.toThrow('invalid_review_page');
    await expect(readAllReviews({ async request() { return Array(100).fill({}); } }, 56)).rejects.toThrow('review_pagination_limit');
  });
});

describe('승인된 연속 실행 검증', () => {
  it('허용된 조정자 workflow_dispatch만 CI 증거로 인정한다', () => {
    const f = fixture();
    const dispatch = { ...f.run, event: 'workflow_dispatch', path: '.github/workflows/loop-validation.yml' };
    expect(readJobCIEvidence(f.expected, [f.check], dispatch, f.job, f.log)).toEqual(f.proof);
    expect(() => readJobCIEvidence(f.expected, [f.check], { ...dispatch, path: '.github/workflows/checks.yml' }, f.job, f.log)).toThrow('invalid_or_stale_run');
  });
});
