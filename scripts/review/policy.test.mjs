import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { evaluateMergeGate, PR_SECTIONS, validatePRBody } from './policy.mjs';
import { createCIEvidence } from './ci-evidence.mjs';

const policy = JSON.parse(readFileSync(new URL('../../.github/review-policy.json', import.meta.url)));
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), MERGE = 'c'.repeat(40);
function fixture() {
  return {
    pr: { number: 1, state: 'open', merged: false, draft: false, mergeable: true, mergeable_state: 'clean',
      user: { login: 'silverThunder09' }, labels: [], merge_commit_sha: MERGE,
      head: { sha: HEAD, repo: { full_name: policy.repository } },
      base: { sha: BASE, ref: 'main', repo: { full_name: policy.repository } } },
    review: { source: 'current-run', head_sha: HEAD, base_sha: BASE, outstanding_findings: 0, unresolved_threads: 0, open_review_issues: 0, change_requests: 0, changed_paths: ['src/renderer/src/App.tsx'] },
    authorization: { scope_approved: true },
    checks: policy.required_checks.map((name, i) => ({ id: i + 1, name, head_sha: HEAD, app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success', details_url: `https://github.com/${policy.repository}/actions/runs/${i + 10}/job/100` })),
    evidence: policy.required_checks.map((context, i) => ({ context, repository: policy.repository, pr_number: 1, run_id: String(i + 10), head_sha: HEAD, base_sha: BASE, checkout_sha: MERGE })),
  };
}
test('accepts fully reviewed, authorized changes with current CI evidence', () => {
  assert.equal(evaluateMergeGate(fixture(), policy).allowed, true);
});
const mutations = {
  'draft': (v) => { v.pr.draft = true; },
  'closed': (v) => { v.pr.state = 'closed'; },
  'fork': (v) => { v.pr.head.repo.full_name = 'attacker/fork'; },
  'author': (v) => { v.pr.user.login = 'attacker'; },
  'target': (v) => { v.pr.base.ref = 'release'; },
  'conflict': (v) => { v.pr.mergeable = false; },
  'merge state': (v) => { v.pr.mergeable_state = 'unstable'; },
  'unknown scope': (v) => { v.authorization.scope_approved = false; },
  'stale review head': (v) => { v.review.head_sha = BASE; },
  'base moved': (v) => { v.pr.base.sha = HEAD; },
  'findings': (v) => { v.review.outstanding_findings = 1; },
  'threads': (v) => { v.review.unresolved_threads = 1; },
  'issues': (v) => { v.review.open_review_issues = 1; },
  'human change request': (v) => { v.review.change_requests = 1; },
  'missing review state': (v) => { delete v.review.change_requests; },
  'missing labels': (v) => { delete v.pr.labels; },
  'missing diff': (v) => { v.review.changed_paths = []; },
  'paused': (v) => { v.pr.labels = [{ name: 'agent-paused' }]; },
  'policy edit': (v) => { v.review.changed_paths = ['.github/review-policy.json']; },
  'nested instructions edit': (v) => { v.review.changed_paths = ['src/main/AGENTS.md']; },
  'missing check': (v) => { v.checks.pop(); },
  'failed check': (v) => { v.checks[0].conclusion = 'failure'; },
  'skipped check': (v) => { v.checks[0].conclusion = 'skipped'; },
  'pending check': (v) => { v.checks[0].status = 'in_progress'; },
  'stale check': (v) => { v.checks[0].head_sha = BASE; },
  'spoofed CI source': (v) => { v.checks[0].app.slug = 'other-bot'; },
  'missing CI proof': (v) => { v.evidence = []; },
  'wrong CI base': (v) => { v.evidence[0].base_sha = HEAD; },
  'wrong checkout': (v) => { v.evidence[0].checkout_sha = HEAD; },
  'wrong PR proof': (v) => { v.evidence[0].pr_number = 2; },
  'wrong run proof': (v) => { v.evidence[0].run_id = '500'; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`blocks ${name}`, () => {
  const value = fixture(); mutate(value); assert.equal(evaluateMergeGate(value, policy).allowed, false);
});
test('a successful old check cannot hide a failing latest attempt', () => {
  const value = fixture(); value.checks.push({ ...value.checks[0], id: 1000, conclusion: 'failure' });
  assert.equal(evaluateMergeGate(value, policy).allowed, false);
});
test('protected changes require an explicit user request independently of scope', () => {
  const value = fixture(); value.review.changed_paths = ['.github/review-policy.json'];
  value.authorization.protected_change_explicitly_approved = true;
  assert.equal(evaluateMergeGate(value, policy).allowed, true);
});
test('missing input is denied', () => { assert.equal(evaluateMergeGate({}, policy).allowed, false); });
test('PR template comments do not count as filled sections', () => {
  assert.ok(validatePRBody(readFileSync(new URL('../../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8')).length);
  assert.deepEqual(validatePRBody(PR_SECTIONS.map((s) => `## ${s}\n검증 내용`).join('\n\n')), []);
  assert.ok(validatePRBody('## 검증\n통과').length);
});
test('CI evidence binds the actual merge checkout to both parent commits', () => {
  const event = { pull_request: { number: 1, base: { sha: BASE }, head: { sha: HEAD } } };
  const env = { GITHUB_REPOSITORY: policy.repository, GITHUB_JOB: 'checks', GITHUB_RUN_ID: '10' };
  assert.equal(createCIEvidence(event, env, MERGE, [BASE, HEAD]).base_sha, BASE);
  assert.throws(() => createCIEvidence(event, env, MERGE, [HEAD, BASE]));
  assert.equal(createCIEvidence({}, env, MERGE, []), null);
});
