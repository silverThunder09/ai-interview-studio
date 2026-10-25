/** Bounded repair of completed official AI findings; never grants human approval. */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { allPages } from './event-worker.ts';
import { countChangeRequests } from './policy.mjs';
const ensure = (value, code) => { if (!value) throw new Error(code); };
const BOT = 'chatgpt-codex-connector';
const marker = (pr, f) => `<!-- ais-repair-issue:${pr}:${createHash('sha256').update(f.path + '\n' + f.body.split('\n')[0]).digest('hex')} -->`;
export async function startReviewRepair({ api, task, definition, report, reviews, policy, update }) {
  ensure(countChangeRequests(reviews) === 0, 'human_changes_block_repair');
  ensure(task.cycles < policy.max_fix_cycles && (task.repairs?.length ?? 0) < 3, 'repair_limit');
  ensure(Buffer.byteLength(JSON.stringify(report)) <= 16384, 'repair_report_limit');
  ensure(report.head_sha === task.head && report.base_sha === task.base && report.findings.length > 0 && report.findings.every(f => definition.allowed_paths.includes(f.path) && ['P1', 'P2', 'P3'].includes(f.severity)), 'unapproved_repair_finding');
  const issues = await allPages(api, '/issues?state=all'), tracked = [];
  for (const f of report.findings) {
    const tag = marker(task.pr, f), matches = issues.filter(i => !i.pull_request && i.body?.includes(tag));
    ensure(matches.length <= 1, 'ambiguous_repair_issue');
    let issue = matches[0];
    if (!issue) {
      issue = await api.request('POST', '/issues', { title: `[Review][${f.severity}] PR #${task.pr}: ${f.path} — ${f.body.split('\n')[0].replace(/<[^>]*>|!\[[^\]]*\]\([^)]*\)|\*\*/g, '').trim().slice(0,100)}`, body: `${tag}\n## 심각도\n${f.severity}\n## PR·head·파일\nPR #${task.pr}; head ${task.head}; ${f.path}:${f.line}\n## 재현·근거·영향\n${f.body}\n원본: ${f.url}\n## 수정 AC\n기존 승인 경로 안에서 위 결함을 고치고 기존 검사·실패 경로를 보존합니다.\n## 검증\n수정 commit·최신 CI3종 Record·새 정확한 head의 AI 검토를 확인한 뒤 해결 처리합니다. 실제 장치/유료 호출은 포함하지 않습니다.` });
      ensure(Number.isSafeInteger(issue.number) && issue.number > 0, 'invalid_repair_issue'); issues.push({ ...issue, body: issue.body ?? tag });
    } else if (issue.state === 'closed') await api.request('PATCH', `/issues/${issue.number}`, { state: 'open' });
    tracked.push({ ...f, issue: issue.number, marker: tag });
  }
  await update(t => {
    (t.repairs ??= []).push({ request: t.request, delivery: t.delivery, review: t.review, report, issues: tracked, head: t.head, base: t.base });
    t.cycles++; t.phase = 'queued'; t.repair_findings = tracked; t.request = null; t.delivery = null; t.review = null; t.operation = null; t.applied = null; t.validated_ci = null; t.policy_update = null; t.waiting = null;
  });
}
async function threads(api, pr) {
  let cursor = null; const nodes = [];
  for (let page = 0; page < 100; page++) {
    const result = await api.graphql('query($pr:Int!,$after:String){repository(owner:"silverThunder09",name:"ai-interview-studio"){pullRequest(number:$pr){reviewThreads(first:100,after:$after){nodes{id isResolved isOutdated comments(first:100){nodes{databaseId body author{login __typename}}pageInfo{hasNextPage}}}pageInfo{hasNextPage endCursor}}}}}', { pr, after: cursor });
    const t = result.data?.repository?.pullRequest?.reviewThreads; ensure(Array.isArray(t?.nodes), 'missing_repair_threads'); nodes.push(...t.nodes);
    if (t.pageInfo.hasNextPage === false) return nodes;
    ensure(typeof t.pageInfo.endCursor === 'string' && t.pageInfo.endCursor !== cursor, 'incomplete_repair_threads'); cursor = t.pageInfo.endCursor;
  }
  throw new Error('repair_thread_limit');
}
const botOnly = t => t.isOutdated === true && t.comments?.pageInfo?.hasNextPage === false && Array.isArray(t.comments.nodes) && t.comments.nodes.length > 0 && t.comments.nodes.every(c => c.author?.login === BOT && c.author.__typename === 'Bot');
export async function finishReviewRepair({ api, task, review, update }) {
  if (!task.repair_findings?.length) return;
  ensure(review.findings.length === 0 && review.head_sha === task.head && review.base_sha === task.base && task.validated_ci?.length === 3 && task.applied?.sha === task.head, 'unverified_repair');
  const pending = task.repairs.filter(r => !r.verified_head), findings = pending.flatMap(r => r.issues);
  for (const repair of pending) {
    const diff = await api.request('GET', `/compare/${repair.head}...${task.head}`);
    ensure(Array.isArray(diff.files) && repair.issues.every(f => diff.files.some(c => c.filename === f.path && c.status === 'modified')), 'repair_file_not_changed');
  }
  for (const thread of await threads(api, task.pr)) {
    if (thread.isResolved || !thread.comments?.nodes?.some(c => findings.some(f => f.id === c.databaseId))) continue;
    ensure(botOnly(thread), 'human_or_current_thread_blocks_repair');
    const resolved = await api.graphql('mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}', { id: thread.id });
    ensure(resolved.data?.resolveReviewThread?.thread?.isResolved === true, 'repair_thread_resolve_failed');
    const again = (await threads(api, task.pr)).find(t => t.id === thread.id);
    if (!again || !botOnly(again)) {
      await api.graphql('mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{isResolved}}}', { id: thread.id });
      throw new Error('repair_thread_changed');
    }
  }
  for (const f of findings) {
    const issue = await api.request('GET', `/issues/${f.issue}`); ensure(issue.body?.includes(f.marker), 'repair_issue_changed');
    if (issue.state !== 'closed') {
      await api.request('POST', `/issues/${f.issue}/comments`, { body: `수정 ${task.head}; 최신 CI3개 실제 증거와 같은 head/base의 새 AI 검토에서 finding0을 확인했습니다. PR #${task.pr}. 기존 사람 리뷰·스레드·머지 조건은 별도로 유지합니다.` });
      await api.request('PATCH', `/issues/${f.issue}`, { state: 'closed', state_reason: 'completed' });
    }
  }
  await update(t => { t.repairs.filter(r => !r.verified_head).forEach(r => { r.verified_head = t.head; }); t.repair_findings = null; });
}
