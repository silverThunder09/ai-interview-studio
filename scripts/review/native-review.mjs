/** Official GitHub Codex review receipts are evidence, never instructions or human approval. */
const REPO = 'silverThunder09/ai-interview-studio';
const BOT = 'chatgpt-codex-connector[bot]';
const SUMMARY = '<!-- codex-pull-request-review-summary -->';
const RECEIPT = '<!-- codex-review-receipt:v1 -->';
const SHA = /^[a-f0-9]{40}$/;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k));
function requireValue(value, code) { if (!value) throw new Error(code); }
function compactJSON(value) {
  let result = '', quoted = false, escaped = false;
  for (const char of value) {
    if (quoted || !/[\t\r\n ]/.test(char)) result += char;
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
  }
  return result;
}
export function parseNativeReviewResult(comments, request) {
  const requested = Date.parse(request?.requested_at);
  requireValue(Array.isArray(comments) && request?.schema === 2 && request.mode === 'read-only' && request.repository === REPO && Number.isSafeInteger(request.pr_number) && request.pr_number > 0 && SHA.test(request.head_sha ?? '') && SHA.test(request.base_sha ?? '') && /^[a-f0-9]{64}$/.test(request.request_key ?? '') && Number.isFinite(requested), 'invalid_native_review_context');
  const official = comments.filter(c => c?.user?.login === BOT && c.user.type === 'Bot' && Number.isSafeInteger(c.id) && c.id > 0 && c.html_url === `https://github.com/${REPO}/pull/${request.pr_number}#issuecomment-${c.id}` && typeof c.body === 'string' && c.body.length <= 96 * 1024);
  const summaries = official.filter(c => c.body.startsWith(SUMMARY + '\n'));
  const receipts = official.filter(c => c.body.startsWith(RECEIPT + '\n') && Date.parse(c.created_at) >= requested);
  if (!summaries.length || !receipts.length) return null;
  const current = [];
  for (const summary of summaries) {
    const matches = [...summary.body.matchAll(/^<!-- codex-review-state:v1 (\{.*\}) -->$/gm)];
    requireValue(matches.length === 1, 'invalid_native_review_state');
    let state; try { state = JSON.parse(matches[0][1]); } catch { throw new Error('invalid_native_review_state'); }
    requireValue(JSON.stringify(state) === compactJSON(matches[0][1]) && keys(state, ['code_review', 'security_review']) && ['code_review', 'security_review'].every(k => keys(state[k], ['commit_sha', 'has_any_findings', 'has_unresolved_findings', 'status'])), 'invalid_native_review_state');
    if (state.code_review.commit_sha !== request.head_sha) continue;
    if (['queued', 'pending', 'running', 'in_progress'].includes(state.code_review.status)) return null;
    requireValue(state.code_review.status === 'completed', 'native_review_not_successful');
    requireValue(state.code_review.has_any_findings === false && state.code_review.has_unresolved_findings === false, 'native_review_has_findings');
    const security = state.security_review;
    requireValue(Object.values(security).every(v => v === null) || (security.commit_sha === request.head_sha && security.status === 'completed' && security.has_any_findings === false && security.has_unresolved_findings === false), 'native_security_review_not_clear');
    const rows = [...summary.body.matchAll(/^\| 📝 \*\*Code Review\*\* \| ✅ \*\*Completed\*\* <relative-time datetime="([^"]+)">/gm)];
    requireValue(rows.length === 1, 'missing_native_review_completion');
    const completed = Date.parse(rows[0][1]), updated = Date.parse(summary.updated_at), created = Date.parse(summary.created_at);
    requireValue(Number.isFinite(completed) && Number.isFinite(updated) && Number.isFinite(created) && created <= updated && completed <= updated, 'invalid_native_review_time');
    if (completed < requested) continue;
    const matching = receipts.filter(c => {
      const commits = [...c.body.matchAll(/^\*\*Reviewed commit:\*\* `([a-f0-9]{10,40})`\s*$/gm)];
      return commits.length === 1 && request.head_sha.startsWith(commits[0][1]) && Date.parse(c.created_at) <= completed;
    });
    requireValue(matching.length <= 1, 'ambiguous_native_review_receipt');
    if (matching.length === 1) current.push({ summary, receipt: matching[0], completed_at: rows[0][1] });
  }
  requireValue(current.length <= 1, 'ambiguous_native_review_summary');
  if (!current.length) return null;
  const { summary, receipt, completed_at } = current[0];
  return { schema: 1, repository: REPO, pr_number: request.pr_number, request_key: request.request_key, head_sha: request.head_sha, base_sha: request.base_sha, findings: [], comment_id: receipt.id, task_url: summary.html_url, source: 'official-github-codex-review', summary_id: summary.id, completed_at };
}
