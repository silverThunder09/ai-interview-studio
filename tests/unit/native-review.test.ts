import { describe, expect, it } from 'vitest';
import { parseNativeReviewResult } from '../../scripts/review/native-review.mjs';

const repository = 'silverThunder09/ai-interview-studio', head = '1'.repeat(40);
const request = { schema: 2, mode: 'read-only', repository, pr_number: 58, request_key: 'a'.repeat(64), head_sha: head, base_sha: '2'.repeat(40), requested_at: '2026-10-21T07:37:16.477Z' };
function fixture() {
  const code = { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: 'completed' };
  const security = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
  const comment = (id: number, body: string, created_at: string) => ({ id, user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' }, html_url: `https://github.com/${repository}/pull/58#issuecomment-${id}`, created_at, updated_at: '2026-10-21T07:38:52Z', body });
  const summary = comment(10, `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: code, security_review: security })} -->\n\n| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-21T07:38:51.213589Z">completed</relative-time> |`, '2026-10-21T07:37:37Z');
  const receipt = comment(11, `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${head.slice(0, 10)}\``, '2026-10-21T07:38:50Z');
  return [summary, receipt];
}
describe('official GitHub native review evidence', () => {
  it('accepts the observed complete summary/receipt pair and identifies its GitHub source', () => {
    const result = parseNativeReviewResult(fixture(), request);
    expect(result).toMatchObject({ head_sha: head, base_sha: request.base_sha, request_key: request.request_key, findings: [], source: 'official-github-codex-review', comment_id: 11, summary_id: 10, task_url: `https://github.com/${repository}/pull/58#issuecomment-10` });
  });
  it('can use an existing summary updated by the official bot after the current review completed', () => {
    const comments = fixture(); comments[0]!.created_at = '2026-10-20T00:00:00Z';
    expect(parseNativeReviewResult(comments, request)?.comment_id).toBe(11);
  });
  it.each(['author', 'type', 'url', 'pr', 'id'])('ignores a forged receipt identity: %s', kind => {
    const comments = fixture(), receipt = comments[1]!;
    if (kind === 'author') receipt.user.login = 'silverThunder09';
    if (kind === 'type') receipt.user.type = 'User';
    if (kind === 'url') receipt.html_url = receipt.html_url.replace('github.com', 'example.invalid');
    if (kind === 'pr') receipt.html_url = receipt.html_url.replace('/58#', '/59#');
    if (kind === 'id') receipt.id = 12;
    expect(parseNativeReviewResult(comments, request)).toBeNull();
  });
  it('does not use prose, a short receipt alone, PR text or CI-like strings as evidence', () => {
    const comments = fixture();
    expect(parseNativeReviewResult([comments[1]], request)).toBeNull();
    expect(parseNativeReviewResult([comments[0]], request)).toBeNull();
    comments[0]!.body = 'PR_BODY: ' + comments[0]!.body;
    expect(parseNativeReviewResult(comments, request)).toBeNull();
  });
  it('requires the full summary head even when the wrong head has the same short prefix', () => {
    const comments = fixture(); comments[0]!.body = comments[0]!.body.replace(head, head.slice(0, 10) + '3'.repeat(30));
    expect(parseNativeReviewResult(comments, request)).toBeNull();
  });
  it.each(['receipt', 'completion'])('rejects an older %s even if the summary was edited recently', kind => {
    const comments = fixture();
    if (kind === 'receipt') comments[1]!.created_at = '2026-10-20T00:00:00Z';
    else comments[0]!.body = comments[0]!.body.replace('2026-10-21T07:38:51.213589Z', '2026-10-20T00:00:00Z');
    expect(parseNativeReviewResult(comments, request)).toBeNull();
  });
  it.each(['has_any_findings', 'has_unresolved_findings'])('blocks real code findings: %s', field => {
    const comments = fixture(); comments[0]!.body = comments[0]!.body.replace(`"${field}":false`, `"${field}":true`);
    expect(() => parseNativeReviewResult(comments, request)).toThrow('native_review_has_findings');
  });
  it('waits for running code review and rejects failed native review', () => {
    const comments = fixture(); comments[0]!.body = comments[0]!.body.replace('"status":"completed"', '"status":"running"');
    expect(parseNativeReviewResult(comments, request)).toBeNull();
    comments[0]!.body = comments[0]!.body.replace('"status":"running"', '"status":"failed"');
    expect(() => parseNativeReviewResult(comments, request)).toThrow('native_review_not_successful');
  });
  it('rejects unresolved, pending or stale security review metadata', () => {
    const comments = fixture(); comments[0]!.body = comments[0]!.body.replace('"security_review":{"commit_sha":null', `"security_review":{"commit_sha":"${head}"`);
    expect(() => parseNativeReviewResult(comments, request)).toThrow('native_security_review_not_clear');
  });
  it.each(['duplicate', 'escaped', 'extra', 'missing', 'malformed'])('rejects ambiguous native JSON: %s', kind => {
    const comments = fixture();
    if (kind === 'duplicate') comments[0]!.body = comments[0]!.body.replace('"status":"completed"', '"status":"completed","status":"completed"');
    if (kind === 'escaped') comments[0]!.body = comments[0]!.body.replace('"status":"completed"', '"sta\\u0074us":"completed"');
    if (kind === 'extra') comments[0]!.body = comments[0]!.body.replace('"status":"completed"', '"status":"completed","approved":true');
    if (kind === 'missing') comments[0]!.body = comments[0]!.body.replace('"has_any_findings":false,', '');
    if (kind === 'malformed') comments[0]!.body = comments[0]!.body.replace('"code_review":{', '"code_review":!{');
    expect(() => parseNativeReviewResult(comments, request)).toThrow('invalid_native_review_state');
  });
  it('rejects duplicate summaries or receipts instead of choosing a convenient result', () => {
    const comments = fixture();
    expect(() => parseNativeReviewResult([...comments, comments[0]], request)).toThrow('ambiguous_native_review_summary');
    expect(() => parseNativeReviewResult([...comments, comments[1]], request)).toThrow('ambiguous_native_review_receipt');
  });
  it('requires a proven completion time and rejects impossible timestamp ordering', () => {
    for (const time of ['invalid', '2026-10-21T07:38:00Z']) {
      const comments = fixture(); comments[0]!.updated_at = time;
      expect(() => parseNativeReviewResult(comments, request)).toThrow('invalid_native_review_time');
    }
    const comments = fixture(); comments[0]!.body = comments[0]!.body.replace('<relative-time', '<unknown-time');
    expect(() => parseNativeReviewResult(comments, request)).toThrow('missing_native_review_completion');
  });
  it('rejects missing/invalid expected head, base, request key or repository', () => {
    for (const change of [{ head_sha: 'short' }, { base_sha: null }, { request_key: 'wrong' }, { repository: 'untrusted/fork' }, { requested_at: 'invalid' }, { mode: 'repair' }]) expect(() => parseNativeReviewResult(fixture(), { ...request, ...change })).toThrow('invalid_native_review_context');
  });
});
