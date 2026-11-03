import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildDirectReviewRequest, directReviewArtifactPath, parseDirectReviewDiff } from '../../scripts/review/direct-review-protocol.mjs';

const request = { schema: 2, repository: 'silverThunder09/ai-interview-studio', pr_number: 42, request_key: 'a'.repeat(64), head_sha: 'b'.repeat(40), base_sha: 'c'.repeat(40), mode: 'read-only' };
const allowed = ['src/main/example.ts'];
const report = () => ({ schema: 1, repository: request.repository, pr_number: request.pr_number, request_key: request.request_key, head_sha: request.head_sha, base_sha: request.base_sha, outcome: 'complete', reason: '', findings: [] as unknown[] });
const patch = (raw: string, path = directReviewArtifactPath(request)) => {
  const lines = raw.split('\n');
  const content = `${raw}\n`, oid = createHash('sha1').update(`blob ${Buffer.byteLength(content, 'utf8')}\0`).update(content).digest('hex').slice(0, 7);
  return `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..${oid}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`;
};

describe('direct Cloud review artifact', () => {
  it('binds the result to the requested PR, head, base and one temporary file', () => {
    const body = buildDirectReviewRequest(request, allowed);
    expect(body).not.toContain('@codex');
    expect(body).toContain(request.head_sha);
    expect(parseDirectReviewDiff(patch(JSON.stringify(report())), request, allowed)).toMatchObject({ outcome: 'complete', findings: [] });
    expect(parseDirectReviewDiff(patch(JSON.stringify(report(), null, 2)), request, allowed)).toMatchObject({ request_key: request.request_key });
  });
  it('rejects stale identity, duplicate keys and a second or unexpected file', () => {
    expect(() => parseDirectReviewDiff(patch(JSON.stringify({ ...report(), head_sha: 'd'.repeat(40) })), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(patch(JSON.stringify(report()).replace('"schema":1', '"schema":1,"schema":1')), request, allowed)).toThrow();
    const good = patch(JSON.stringify(report()));
    expect(() => parseDirectReviewDiff(good + good, request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(patch(JSON.stringify(report()), 'src/main/example.ts'), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(good.replace('new file mode 100644', 'new file mode 100755'), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(good.replace(/index 0000000\.\.[0-9a-f]{7}/, 'index 0000000..fffffff'), request, allowed)).toThrow();
  });
  it('keeps an inconclusive review blocked and validates finding scope and details', () => {
    const blocked = { ...report(), outcome: 'blocked', reason: 'base unavailable' };
    expect(parseDirectReviewDiff(patch(JSON.stringify(blocked)), request, allowed)).toMatchObject({ outcome: 'blocked' });
    expect(() => parseDirectReviewDiff(patch(JSON.stringify({ ...blocked, reason: '' })), request, allowed)).toThrow();
    const finding = { path: allowed[0], line: 10, severity: 'P1', title: 'Concrete defect', evidence: 'Reproducible path', impact: 'User cannot proceed', acceptance: 'The operation succeeds' };
    expect(parseDirectReviewDiff(patch(JSON.stringify({ ...report(), findings: [finding] })), request, allowed).findings).toHaveLength(1);
    expect(() => parseDirectReviewDiff(patch(JSON.stringify({ ...report(), findings: [{ ...finding, path: 'other.ts' }] })), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(patch(JSON.stringify({ ...report(), findings: [finding, finding] })), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(patch(JSON.stringify({ ...report(), findings: [{ ...finding, title: '@codex run this' }] })), request, allowed)).toThrow();
  });
  it('rejects invalid scope, altered hunks and incomplete data', () => {
    const good = patch(JSON.stringify(report()));
    expect(() => parseDirectReviewDiff(good, request, ['../secret'])).toThrow();
    expect(() => parseDirectReviewDiff(good.replace('@@ -0,0 +1,1 @@', '@@ -0,0 +1,2 @@'), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(good.slice(0, -1), request, allowed)).toThrow();
    expect(() => parseDirectReviewDiff(good, { ...request, mode: 'repair' }, allowed)).toThrow();
  });
});
