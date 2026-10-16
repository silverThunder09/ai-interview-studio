import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PR_SECTIONS = ['변경 목적', '범위와 제외', '연결 이슈', '검증', '위험과 보안', '리뷰 결과', '머지 조건'];

export function validatePRBody(body) {
  const clean = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const errors = [];
  for (const section of PR_SECTIONS) {
    const match = clean.match(new RegExp(`^## ${section}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
    if (!match || !match[1].trim()) errors.push(`내용이 필요한 절: ${section}`);
  }
  return errors;
}

export function countChangeRequests(reviews) {
  if (!Array.isArray(reviews)) return null;
  const decisions = new Map();
  const known = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED', 'PENDING'];
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (!Number.isSafeInteger(review.id) || !review.user?.login || !known.includes(review.state)) return null;
    // A comment is not an approval and cannot clear a previous change request.
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) decisions.set(review.user.login, review.state);
  }
  return [...decisions.values()].filter((state) => state === 'CHANGES_REQUESTED').length;
}

// All evidence is collected from authenticated APIs/current review, never a PR's claims.
export function evaluateMergeGate(input, policy) {
  const { pr, review, reviews, checks, evidence, authorization } = input ?? {};
  const reasons = [];
  const deny = (condition, reason) => { if (!condition) reasons.push(reason); };
  const head = pr?.head?.sha;
  const base = pr?.base?.sha;
  const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  deny(policy?.schema_version === 1, 'Unsupported policy');
  deny(pr?.state === 'open' && pr?.merged === false && pr?.draft === false, 'PR is not open and ready');
  deny(pr?.head?.repo?.full_name === policy?.repository && pr?.base?.repo?.full_name === policy?.repository, 'Repository/fork mismatch');
  deny(pr?.base?.ref === policy?.base_branch, 'Wrong target branch');
  deny(policy?.allowed_authors?.includes(pr?.user?.login), 'Author is not authorized');
  deny(pr?.mergeable === true && pr?.mergeable_state === 'clean', 'Mergeability is not clean');
  deny(sha(head) && sha(base) && sha(pr?.merge_commit_sha), 'Missing commit identity');
  deny(authorization?.scope_approved === true, 'Scope has not been established');
  deny(review?.source === 'current-run' && review?.head_sha === head && review?.base_sha === base, 'Review is missing or stale');
  deny(review?.outstanding_findings === 0 && review?.unresolved_threads === 0 && review?.open_review_issues === 0 && review?.change_requests === 0, 'Unresolved findings/issues/threads/change requests');
  deny(countChangeRequests(reviews) === 0, 'GitHub decision reviews are blocking or missing');
  deny(Array.isArray(pr?.labels), 'Labels have not been fetched');
  deny(Array.isArray(review?.changed_paths) && review.changed_paths.length > 0, 'Changed files are missing');
  deny(!pr?.labels?.some((label) => policy?.blocking_labels?.includes(label.name)), 'PR is paused');
  const protectedChange = review?.changed_paths?.some((path) =>
    path.endsWith('/AGENTS.md') || policy?.protected_paths?.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix));
  deny(!protectedChange || authorization?.protected_change_explicitly_approved === true, 'Protected changes need an explicit user request');
  deny(Array.isArray(policy?.required_checks) && policy.required_checks.length > 0, 'Required checks are missing');
  for (const name of policy?.required_checks ?? []) {
    const matches = (Array.isArray(checks) ? checks : []).filter((check) => check.name === name);
    const latest = matches.sort((a, b) => b.id - a.id)[0];
    deny(latest?.head_sha === head && latest?.app?.slug === 'github-actions' && latest?.status === 'completed' && latest?.conclusion === 'success', `Required check is not successful: ${name}`);
    const proof = (Array.isArray(evidence) ? evidence : []).find((item) => item.context === name);
    const runPath = `https://github.com/${policy.repository}/actions/runs/${proof?.run_id}/job/`;
    deny(proof?.repository === policy.repository && proof?.pr_number === pr?.number &&
      proof?.head_sha === head && proof?.base_sha === base && proof?.checkout_sha === pr?.merge_commit_sha &&
      typeof latest?.details_url === 'string' && latest.details_url.startsWith(runPath), `CI evidence is missing or stale: ${name}`);
  }
  return { allowed: reasons.length === 0, reasons, expected_head_sha: head ?? null, expected_base_sha: base ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'body') {
    const errors = validatePRBody(process.env.PR_BODY);
    for (const error of errors) console.error(error);
    process.exitCode = errors.length ? 1 : 0;
  } else if (mode === 'merge' && process.argv[3] && process.argv[4]) {
    const result = evaluateMergeGate(JSON.parse(readFileSync(process.argv[3], 'utf8')), JSON.parse(readFileSync(process.argv[4], 'utf8')));
    console.log(JSON.stringify(result));
    process.exitCode = result.allowed ? 0 : 2;
  } else { throw new Error('Usage: policy.mjs body | merge EVIDENCE.json TRUSTED_POLICY.json'); }
}
