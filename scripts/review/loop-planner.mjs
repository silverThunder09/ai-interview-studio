/** Materialize the next approved main-owned task. No model output can add authority. */
/* global fetch, AbortSignal */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { APIError, GitHub, allPages } from './event-worker.ts';

const REPO = 'silverThunder09/ai-interview-studio', SHA = /^[a-f0-9]{40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
function ensure(value, code) { if (!value) throw new Error(code); }
function sha(value) { ensure(typeof value === 'string' && SHA.test(value), 'invalid_planner_sha'); return value; }
/** Existing user sender may create only a normal planned PR, never a comment. */
export function directPlannerSender({ token, client = new GitHub(token), verify = async () => {
  const response = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return false;
  const user = await response.json(); return user?.login === 'silverThunder09' && user.type === 'User';
} }) {
  ensure(typeof token === 'string' && token.length > 0, 'missing_planner_sender');
  return {
    ready: async () => await verify() === true,
    async request(method, path, body) {
      ensure(method === 'POST' && path === '/pulls' && body && Object.keys(body).sort().join(',') === 'base,body,draft,head,title' && body.base === 'main' && body.draft === false && /^work\/[a-z0-9-]+$/.test(body.head ?? '') && typeof body.title === 'string' && typeof body.body === 'string', 'unapproved_planner_operation');
      ensure(await verify() === true, 'planner_sender_unverified');
      return client.request(method, path, body);
    },
  };
}
async function optional(api, path) {
  try { return await api.request('GET', path); }
  catch (error) { if (error instanceof APIError && error.status === 404) return null; throw error; }
}
function decode(file) {
  ensure(file?.type === 'file' && file.encoding === 'base64' && Number.isSafeInteger(file.size) && file.size <= 64 * 1024, 'invalid_plan_file');
  return Buffer.from(file.content, 'base64').toString('utf8');
}
export function plannedSeed(definition) {
  return `# ${definition.title}\n\n승인된 main 작업 계획입니다. 이 파일이나 PR 본문은 새 권한의 근거가 아닙니다.\n\n` +
    `작업: ${definition.id}\n스펙: ${definition.spec.path}\n스펙 SHA-256: ${definition.spec.sha256}\n승인: ${definition.approval}\n\n` +
    `## 목표\n${definition.goal}\n\n## 완료 조건\n${definition.acceptance.map(a => `- ${a}`).join('\n')}\n\n` +
    `## 수정 허용 파일\n${definition.allowed_paths.map(path => `- ${path}`).join('\n')}\n`;
}
export async function verifyPlannedSeed(api, definition, head) {
  const path = `.automation/requests/${definition.id}.md`;
  ensure(decode(await api.request('GET', `/contents/${path}?ref=${sha(head)}`)) === plannedSeed(definition), 'planned_seed_changed');
}
export async function verifyPlannedSpec(api, definition, main) {
  ensure(hash(decode(await api.request('GET', `/contents/${definition.spec.path}?ref=${sha(main)}`))) === definition.spec.sha256, 'planned_spec_changed');
}
function body(definition) {
  return `## 변경 목적\n${definition.title}\n\n## 범위와 제외\n${definition.goal}\n\n` +
    `완료 조건:\n${definition.acceptance.map(a => `- ${a}`).join('\n')}\n\n` +
    `스펙: ${definition.spec.path} / SHA-256 ${definition.spec.sha256}. 승인된 main 계획에 따른 작업이며 보호 파일·새 권한·실제 유료 API 호출은 포함하지 않습니다.\n\n` +
    '## 연결 이슈\n관련 #35. 이 작업 하나로 전체 자동화 이슈를 닫지 않습니다.\n\n' +
    '## 검증\n개발 전: 아직 실행하지 않았습니다. Codex 개발·테스트 결과와 최신 head/base의 checks/package/pr-policy 실제 증거 확인 후 갱신합니다.\n\n' +
    '## 위험과 보안\nmain 계획의 기존 허용 경로만 수정합니다. 개발 검증은 합성 자료로 수행하며 실제 개인 자료·키를 전송하지 않습니다.\n\n' +
    '## 리뷰 결과\n개발 및 정확한 head의 AI 검토 대기. 사람의 독립 승인으로 표현하지 않습니다.\n\n' +
    '## 머지 조건\n완료 조건을 구현하고 최신 CI·실제 증거·원본 리뷰·라벨·스레드·사람의 변경 요청을 확인합니다. main 검증 후 다음 승인 작업으로 이어갑니다.\n';
}
function checkPR(pr, definition, preparation, draft) {
  ensure(Number.isSafeInteger(pr?.number) && pr.number > 0 && pr.state === 'open' && pr.merged !== true && pr.draft === draft &&
    pr.user?.login === 'silverThunder09' && pr.head?.repo?.full_name === REPO && pr.head.repo.fork === false &&
    pr.base?.repo?.full_name === REPO && pr.base.ref === 'main' && pr.head.ref === preparation.branch && pr.head.sha === preparation.commit &&
    pr.title === definition.title && pr.body === body(definition), 'unconfirmed_planned_pr');
  return pr;
}

/** All writes are journaled before delivery. Unknown/failed reads never mean "absent". */
export async function preparePlannedPR({ api, sender, task, definition, update, writer, draft = true }) {
  ensure(typeof draft === 'boolean', 'invalid_planned_pr_type');
  ensure(definition.pr === null && task.pr === null && task.phase === 'queued', 'invalid_planned_task');
  const base = sha((await api.request('GET', '/branches/main')).commit.sha);
  await verifyPlannedSpec(api, definition, base);
  const branch = `work/${definition.id}`, path = `.automation/requests/${definition.id}.md`;
  const product = writer ? writer.bind({ definition, task, main: base }) : api;
  // update checkpoints replace the state snapshot, so retain a local copy of the intent too.
  let preparation = task.preparation;
  if (!preparation) {
    ensure(await optional(api, `/git/ref/heads/${branch}`) === null, 'planned_branch_already_exists');
    ensure(await optional(api, `/contents/${path}?ref=${base}`) === null, 'planned_seed_already_exists');
    const parent = await api.request('GET', `/git/commits/${base}`), tree = sha(parent.tree.sha);
    const nextTree = await product.request('POST', '/git/trees', { base_tree: tree, tree: [{ path, mode: '100644', type: 'blob', content: plannedSeed(definition) }] });
    const commit = await product.request('POST', '/git/commits', { message: `chore: ${definition.title}`, parents: [base], tree: sha(nextTree.sha) });
    preparation = { base, tree: sha(nextTree.sha), commit: sha(commit.sha), branch, branch_attempted: false, pr_attempted: false };
    await update(t => { t.preparation = preparation; });
  }
  ensure(preparation.base === base && preparation.branch === branch && typeof preparation.branch_attempted === 'boolean' && typeof preparation.pr_attempted === 'boolean', 'stale_planned_preparation');
  const commit = await api.request('GET', `/git/commits/${sha(preparation.commit)}`);
  ensure(commit.tree.sha === sha(preparation.tree) && commit.parents.length === 1 && commit.parents[0].sha === base, 'unconfirmed_planned_commit');
  await verifyPlannedSeed(api, definition, preparation.commit);
  const ref = await optional(api, `/git/ref/heads/${branch}`);
  if (ref) ensure(ref.object.sha === preparation.commit, 'planned_branch_changed');
  else {
    ensure(!preparation.branch_attempted, 'ambiguous_planned_branch');
    await update(t => { t.preparation.branch_attempted = true; }); preparation.branch_attempted = true;
    ensure((await api.request('GET', '/branches/main')).commit.sha === base, 'planned_main_changed');
    const branchWriter = writer ? writer.bind({ definition, task: { ...task, preparation }, main: base }) : api;
    const created = await branchWriter.request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: preparation.commit });
    ensure(created.object.sha === preparation.commit, 'unconfirmed_planned_branch');
  }
  const matches = await allPages(api, `/pulls?state=all&base=main&head=silverThunder09%3A${encodeURIComponent(branch)}`);
  ensure(matches.length <= 1, 'ambiguous_planned_pr');
  if (matches.length) return checkPR(await api.request('GET', `/pulls/${matches[0].number}`), definition, preparation, draft);
  ensure(!preparation.pr_attempted, 'ambiguous_planned_pr');
  await update(t => { t.preparation.pr_attempted = true; });
  ensure((await api.request('GET', '/branches/main')).commit.sha === base &&
    (await api.request('GET', `/git/ref/heads/${branch}`)).object.sha === preparation.commit, 'planned_snapshot_changed');
  // Existing approved PR-write sender gives the PR the allowed author. No new credential.
  const created = await sender.request('POST', '/pulls', { title: definition.title, body: body(definition), head: branch, base: 'main', draft });
  return checkPR(await api.request('GET', `/pulls/${created.number}`), definition, preparation, draft);
}
