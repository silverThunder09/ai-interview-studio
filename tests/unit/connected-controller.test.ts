import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, applyDevelopmentPatch, buildDevelopmentRequest, renderDevelopmentResult, parseDevelopmentPatch, parseDevelopmentResult, planConnectedResult, type ConnectedSnapshot, type DevelopmentRequest, type DevelopmentReport } from '../../scripts/review/connected-controller';

const A = 'a'.repeat(40), B = 'b'.repeat(40), KEY = 'c'.repeat(64);
const request: DevelopmentRequest = { schema: 2, repository: REPOSITORY, pr_number: 7, request_key: KEY, head_sha: A, base_sha: B, requested_at: '2026-10-20T00:00:00Z', mode: 'read-only', allowed_paths: [] };
const task = `https://chatgpt.com/s/cd_${'1'.repeat(32)}`;
const report = () => ({ schema: 2, kind: 'development-result', repository: REPOSITORY, pr_number: 7, request_key: KEY, checkout_sha: A, requested_base_sha: B,
  outcome: 'succeeded', tests: [{ command: 'npm run check', exit_code: 0, unit_passed: 314, policy_passed: 40 }], change: { kind: 'none' }, blocker: null });
const wrap = (json: string, url = task) => `<!-- ais-development-result-v2:${KEY} -->\n\`\`\`json\n${json}\n\`\`\`\n\n [View task →](${url})`;
const comment = (body = wrap(JSON.stringify(report()))) => ({ id: 101, user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' }, html_url: `https://github.com/${REPOSITORY}/pull/7#issuecomment-101`, created_at: '2026-10-20T00:01:00Z', body });
const snapshot = (): ConnectedSnapshot => ({ source: 'connected-github-current-run', current_main_sha: B, labels_complete: true, comments_complete: true,
  pr: { number: 7, state: 'open', merged: false, user: { login: 'silverThunder09' }, head: { sha: A, ref: 'fix/example', repo: { full_name: REPOSITORY, fork: false } }, base: { sha: B, ref: 'main', repo: { full_name: REPOSITORY } } },
  labels: [], comments: [comment()], processed_receipt_ids: [], contents_head_sha: A, base_tree_sha: B, contents: { 'src/example.ts': { content: 'first\nsecond\nthird\n', mode: '100644', blob_sha: createHash('sha1').update('blob 19\0first\nsecond\nthird\n').digest('hex') } } });
const patch = 'diff --git a/src/example.ts b/src/example.ts\nindex aaaaaaa..bbbbbbb 100644\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,3 +1,3 @@\n first\n-second\n+updated\n third\n';
const repair: DevelopmentRequest = { ...request, mode: 'repair', allowed_paths: ['src/example.ts'] };

describe('development v2 result boundary', () => {
  it.each(['failed', 'blocked'] as const)('does not treat a %s report with a patch as an applicable result', outcome => {
    const value = { ...report(), outcome, tests: [{ command: 'npm run check', exit_code: 0 }, { command: 'npm run test:smoke', exit_code: 1 }], change: { kind: 'patch', patch }, blocker: { code: 'electron_runtime_dependency_missing', summary: 'Electron 실행 라이브러리가 없어 smoke를 시작하지 못했습니다.' } };
    const c = comment(wrap(JSON.stringify(value)));
    expect(() => parseDevelopmentResult(c, repair)).toThrow('unexpected_patch');
    expect(planConnectedResult({ ...snapshot(), comments: [c] }, repair)).toEqual({ action: 'blocked', reason: 'unexpected_patch' });
    expect(buildDevelopmentRequest(repair)).toContain('failed/blocked 결과의 change는 반드시 {"kind":"none"}');
  });
  it('shows readable results above folded JSON while keeping the exact report and patch contract', () => {
    const value = { ...report(), change: { kind: 'patch', patch } } as DevelopmentReport;
    const body = renderDevelopmentResult(value, '요청한 동작과 관련 테스트를 수정했습니다.');
    const result = parseDevelopmentResult(comment(body + `\n\n [View task →](${task})`), repair);
    expect(result.report.change).toEqual(value.change);
    const pretty = body.replace(JSON.stringify(value), JSON.stringify(value, null, 2));
    expect(parseDevelopmentResult(comment((pretty + `\n\n [View task →](${task})`).replaceAll('\n', '\r\n')), repair).report).toEqual(result.report);
    expect(planConnectedResult({ ...snapshot(), comments: [comment(body + `\n\n [View task →](${task})`)] }, repair)).toMatchObject({ action: 'commit', expected_head_sha: A, merge_authorized: false });
    expect(body.indexOf('단위 314개')).toBeLessThan(body.indexOf('<details>'));
    expect(body.indexOf('diff --git')).toBeGreaterThan(body.indexOf('<details>'));
    expect(body).toContain('원격 CI·코드 리뷰·머지는 별도 검증');
    expect(buildDevelopmentRequest(request)).toContain('renderDevelopmentResult');
  });
  it.each(['failed', 'blocked'] as const)('keeps %s visible and refuses a contradictory readable success', outcome => {
    const value = { ...report(), outcome, tests: outcome === 'failed' ? [{ command: 'npm run check', exit_code: 1 }] : [], blocker: { code: 'test_blocked', summary: '필요한 <장치>를 확인하세요.' } } as DevelopmentReport;
    const body = renderDevelopmentResult(value, '검사를 시도했으나 완료하지 못했습니다.');
    expect(parseDevelopmentResult(comment(body + `\n\n [View task →](${task})`), request).report.outcome).toBe(outcome);
    expect(body.slice(0, body.indexOf('<details>'))).toContain(outcome === 'failed' ? '작업 실패' : '작업 보류');
    expect(body).toContain('&lt;장치&gt;');
    expect(() => parseDevelopmentResult(comment(body.replace('### 실패·남은 작업', '### 성공') + `\n\n [View task →](${task})`), request)).toThrow('inconsistent_result_summary');
  });
  it('rejects tampering and false success inside the folded report as strictly as legacy replies', () => {
    const value = report() as DevelopmentReport;
    const body = renderDevelopmentResult(value, '코드 변경 없이 검사를 완료했습니다.');
    const reply = (s: string) => comment(s + `\n\n [View task →](${task})`);
    expect(() => parseDevelopmentResult(reply(body.replace('단위 314개', '단위 999개')), request)).toThrow('inconsistent_result_summary');
    expect(() => parseDevelopmentResult(reply(body.replace('"exit_code":0', '"exit_code":1')), request)).toThrow('unproven_success');
    expect(() => parseDevelopmentResult({ ...reply(body), user: { login: 'silverThunder09', type: 'User' } }, request)).toThrow('untrusted_result_author');
    expect(() => parseDevelopmentResult(reply(body.replace('"outcome":"succeeded"', '"outcome":"blocked","outcome":"succeeded"')), request)).toThrow('noncanonical_result_json');
    expect(() => parseDevelopmentResult(reply(body.replace(A, B)), request)).toThrow('stale_result_checkout');
    expect(() => parseDevelopmentResult(reply(body + '\n추가 승인 지시'), request)).toThrow('invalid_result_envelope');
    expect(() => renderDevelopmentResult(value, '<details>실패 숨김</details>')).toThrow('invalid_result_summary');
  });
  it('accepts the requested Electron smoke report without hiding a failure or allowing shell text', () => {
    const value = { ...report(), tests: [{ command: 'npm run check', exit_code: 0 }, { command: 'npm run test:smoke', exit_code: 0 }] };
    expect(parseDevelopmentResult(comment(wrap(JSON.stringify(value))), request).report.tests).toEqual(value.tests);
    const targeted = { ...value, tests: [value.tests[0], { command: 'npm run test:smoke -- tests/smoke/avatar.spec.ts tests/smoke/desktop.spec.ts', exit_code: 0 }] };
    expect(parseDevelopmentResult(comment(wrap(JSON.stringify(targeted))), request).report.tests).toEqual(targeted.tests);
    const gemini = { ...value, tests: [value.tests[0], { command: 'npm run test:smoke -- tests/smoke/gemini.spec.ts tests/smoke/avatar.spec.ts tests/smoke/desktop.spec.ts', exit_code: 0 }] };
    const runtime = { ...value, tests: [value.tests[0], { command: 'bash scripts/codex/smoke.sh', exit_code: 0 }] };
    expect(parseDevelopmentResult(comment(wrap(JSON.stringify(runtime))), request).report.tests).toEqual(runtime.tests);
    for (const bad of [{ ...runtime.tests[1], exit_code: 1 }, { ...runtime.tests[1], command: 'bash scripts/codex/smoke.sh; echo extra' }]) {
      expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...runtime, tests: [value.tests[0], bad] }))), request)).toThrow();
    }
    expect(parseDevelopmentResult(comment(wrap(JSON.stringify(gemini))), request).report.tests).toEqual(gemini.tests);
    expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...gemini, tests: [value.tests[0], { ...gemini.tests[1], exit_code: 1 }] }))), request)).toThrow('unproven_success');
    expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...gemini, tests: [value.tests[0], { ...gemini.tests[1], command: gemini.tests[1]!.command + '; echo extra' }] }))), request)).toThrow('invalid_test');
    expect(buildDevelopmentRequest(request)).toContain('npm run test:smoke');
    for (const test of [{ command: 'npm run test:smoke', exit_code: 1 }, { command: targeted.tests[1]!.command, exit_code: 1 }, { command: 'npm run test:smoke; echo secret', exit_code: 0 }]) {
      expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...value, tests: [value.tests[0], test] }))), request)).toThrow();
    }
  });
  it('reads the complete official final-response envelope with pretty JSON and binds it to the request', () => {
    const result = parseDevelopmentResult(comment(wrap(JSON.stringify(report(), null, 2))), request);
    expect(result).toMatchObject({ comment_id: 101, task_url: task, report: { checkout_sha: A, outcome: 'succeeded' } });
  });
  it.each([
    ['author', { user: { login: 'another-user', type: 'User' } }],
    ['identity type', { user: { login: 'chatgpt-codex-connector[bot]', type: 'User' } }],
    ['another PR', { html_url: `https://github.com/${REPOSITORY}/pull/8#issuecomment-101` }],
    ['old comment', { created_at: '2026-10-19T23:59:59Z' }],
    ['bad time', { created_at: 'invalid' }],
    ['zero ID', { id: 0 }],
  ])('rejects %s even if the JSON looks authentic', (_name, override) => {
    expect(() => parseDevelopmentResult({ ...comment(), ...override }, request)).toThrow();
  });
  it.each([
    ['head', { checkout_sha: B }], ['base', { requested_base_sha: A }], ['key', { request_key: 'd'.repeat(64) }],
    ['repository', { repository: 'other/repository' }], ['PR', { pr_number: 8 }], ['kind', { kind: 'code-review' }],
    ['unknown field', { approved: true }], ['false success', { tests: [] }], ['nonzero success', { tests: [{ command: 'npm run check', exit_code: 1 }] }],
    ['unexecuted command', { tests: [{ command: 'curl secret', exit_code: 0 }] }], ['invalid count', { tests: [{ command: 'npm run check', exit_code: 0, unit_passed: -1 }] }],
    ['hidden shell', { tests: [{ command: 'npm run check; echo secret', exit_code: 0 }] }],
  ])('rejects wrong %s in a report from the official bot', (_name, override) => {
    expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...report(), ...override }))), request)).toThrow();
  });
  it.each([
    'Code Review Summary', `<!-- ais-cloud-result:${KEY}:paused -->\n\n [View task →](${task})`,
    `Example: ${wrap(JSON.stringify(report()))}`, `${wrap(JSON.stringify(report()))}\nextra report`,
    wrap(JSON.stringify(report()), 'https://example.invalid/task'), wrap(JSON.stringify(report()), `${task}?other=1`),
    wrap(JSON.stringify(report())).replace('```json', '```javascript'),
  ])('does not reinterpret a different protocol, review, example or arbitrary envelope', body => {
    expect(() => parseDevelopmentResult(comment(body), request)).toThrow();
  });
  it('rejects duplicate keys instead of trusting JSON.parse last-value behavior', () => {
    const json = JSON.stringify(report()).replace('"outcome":"succeeded"', '"outcome":"blocked","outcome":"succeeded"');
    expect(() => parseDevelopmentResult(comment(wrap(json)), request)).toThrow('noncanonical_result_json');
  });
  it('requires a readable reason for blocked/failed outcomes and preserves that they did not succeed', () => {
    const value = { ...report(), outcome: 'blocked', tests: [], blocker: { code: 'checkout_missing', summary: '지정 checkout을 읽을 수 없습니다' } };
    expect(parseDevelopmentResult(comment(wrap(JSON.stringify(value))), request).report.outcome).toBe('blocked');
    expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...value, blocker: null }))), request)).toThrow();
    expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...value, outcome: 'failed' }))), request)).toThrow('unproven_failure');
    expect(parseDevelopmentResult(comment(wrap(JSON.stringify({ ...value, outcome: 'failed', tests: [{ command: 'npm run check', exit_code: 1 }] }))), request).report.outcome).toBe('failed');
  });
  it('rejects an observed aggregate passed field without accepting or applying its patch', () => {
    const value = { ...report(), tests: [{ command: 'npm run check', exit_code: 0, passed: 443 }], change: { kind: 'patch', patch } };
    const result = comment(wrap(JSON.stringify(value)));
    expect(() => parseDevelopmentResult(result, repair)).toThrow('invalid_fields');
    expect(planConnectedResult({ ...snapshot(), comments: [result] }, repair)).toEqual({ action: 'blocked', reason: 'invalid_fields' });
  });
  it('rejects a patch in a read-only report and an oversized response', () => {
    expect(() => parseDevelopmentResult(comment(wrap(JSON.stringify({ ...report(), change: { kind: 'patch', patch } }))), request)).toThrow('unexpected_patch');
    expect(() => parseDevelopmentResult(comment('x'.repeat(100_000)), request)).toThrow('result_size');
  });
});

describe('patch data boundary', () => {
  it('applies a matching text patch without changing surrounding contents', () => {
    expect(applyDevelopmentPatch(patch, repair.allowed_paths, { 'src/example.ts': 'first\nsecond\nthird\n' })).toEqual([{ path: 'src/example.ts', content: 'first\nupdated\nthird\n' }]);
  });
  it('handles zero-count insertion and deletion positions', () => {
    const header = 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n';
    expect(applyDevelopmentPatch(`${header}@@ -0,0 +1 @@\n+new\n`, repair.allowed_paths, { 'src/example.ts': 'old\n' })[0]?.content).toBe('new\nold\n');
    expect(applyDevelopmentPatch(`${header}@@ -1 +0,0 @@\n-old\n`, repair.allowed_paths, { 'src/example.ts': 'old\n' })[0]?.content).toBe('');
  });
  it.each(['../escape', '/tmp/escape', '.git/config', 'src/../example.ts', 'src//example.ts', 'AGENTS.md', 'src/AGENTS.md', '.github/workflows/x.yml', 'scripts/review/x.ts', 'package.json', 'src/package-lock.json'])('rejects unapproved/protected path %s', path => {
    expect(() => parseDevelopmentPatch(patch.replaceAll('src/example.ts', path), [path])).toThrow();
  });
  it.each([
    patch.replace(' b/src/example.ts', ' b/src/renamed.ts'), patch.replace('--- a/src/example.ts', '--- /dev/null'),
    patch.replace('100644', '100755'), patch.replace('index aaaaaaa..bbbbbbb 100644', 'new file mode 100644'),
    patch.replace('@@ -1,3 +1,3 @@', '@@ -1,4 +1,3 @@'), patch.replace('+updated', '\\ No newline at end of file'),
    patch + patch, patch.replaceAll('\n', '\r\n'), patch + 'GIT binary patch\n', patch.slice(0, -1),
  ])('rejects unsupported patch structure instead of guessing how to apply it', value => {
    expect(() => parseDevelopmentPatch(value, repair.allowed_paths)).toThrow();
  });
  it('does not apply a patch to different contents or overlapping/mispositioned hunks', () => {
    expect(() => applyDevelopmentPatch(patch, repair.allowed_paths, { 'src/example.ts': 'changed\n' })).toThrow('patch_context_mismatch');
    expect(() => applyDevelopmentPatch(patch.replace('+1,3', '+2,3'), repair.allowed_paths, { 'src/example.ts': 'first\nsecond\nthird\n' })).toThrow('inconsistent_patch_position');
    expect(() => applyDevelopmentPatch(patch.replace(' third\n', ' third\n@@ -1 +1 @@\n-first\n+again\n'), repair.allowed_paths, { 'src/example.ts': 'first\nsecond\nthird\n' })).toThrow('overlapping_patch');
    expect(() => applyDevelopmentPatch(patch, ['src/other.ts'], { 'src/example.ts': 'first\nsecond\nthird\n' })).toThrow('patch_path_not_allowed');
  });
  it('keeps shell-looking added text as data and bounds patch size', () => {
    expect(applyDevelopmentPatch(patch.replace('+updated', '+$(synthetic-command)'), repair.allowed_paths, { 'src/example.ts': 'first\nsecond\nthird\n' })[0]?.content).toContain('$(synthetic-command)');
    expect(() => parseDevelopmentPatch(patch + 'x'.repeat(65_536), repair.allowed_paths)).toThrow('invalid_patch_size_or_encoding');
  });
});

describe('connected GitHub handoff planner', () => {
  it('requires independent review/CI even after a successful local report', () => {
    expect(planConnectedResult(snapshot(), request)).toEqual({ action: 'review', head_sha: A, base_sha: B, receipt_id: 101, task_url: task, merge_authorized: false });
  });
  it('waits without a result, deduplicates a processed receipt and blocks ambiguous results', () => {
    expect(planConnectedResult({ ...snapshot(), comments: [] }, request)).toEqual({ action: 'wait', reason: 'result_missing' });
    expect(planConnectedResult({ ...snapshot(), processed_receipt_ids: [101] }, request)).toEqual({ action: 'wait', reason: 'already_processed' });
    expect(planConnectedResult({ ...snapshot(), comments: [comment(), { ...comment(), id: 102 }] }, request)).toEqual({ action: 'blocked', reason: 'ambiguous_results' });
  });
  it.each(['needs-user', 'agent-paused'])('does not bypass %s', name => {
    expect(planConnectedResult({ ...snapshot(), labels: [{ name }] }, request)).toEqual({ action: 'blocked', reason: 'blocking_label' });
  });
  it.each([{ source: 'pr-body' }, { labels_complete: false }, { comments_complete: false }, { current_main_sha: A }])('rejects missing/stale current API evidence: %s', override => {
    expect(() => planConnectedResult({ ...snapshot(), ...override }, request)).toThrow();
  });
  it('binds a commit plan to the currently checked branch/head and never authorizes merge', () => {
    const r = { ...report(), change: { kind: 'patch', patch } };
    const value = { ...snapshot(), comments: [comment(wrap(JSON.stringify(r)))] };
    expect(planConnectedResult(value, repair)).toMatchObject({ action: 'commit', parent_sha: A, expected_head_sha: A, branch: 'fix/example', force: false, merge_authorized: false, files: [{ path: 'src/example.ts', content: 'first\nupdated\nthird\n' }] });
    const p = value.pr as { head: { sha: string } }; p.head.sha = B;
    expect(() => planConnectedResult(value, repair)).toThrow('stale_current_state');
  });
  it.each(['contents_head_sha', 'base_tree_sha', 'mode', 'blob_sha', 'content'])('rejects stale content or unsafe blob %s', field => {
    const value = snapshot();
    value.comments = [comment(wrap(JSON.stringify({ ...report(), change: { kind: 'patch', patch } })))];
    if (field === 'contents_head_sha' || field === 'base_tree_sha') value[field] = 'stale';
    else (value.contents as Record<string, Record<string, string>>)['src/example.ts']![field] = field === 'mode' ? '120000' : 'invalid';
    expect(() => planConnectedResult(value, repair)).toThrow();
  });
  it('keeps blocked reports blocked with a diagnostic reason', () => {
    const r = { ...report(), outcome: 'blocked', tests: [], blocker: { code: 'test_unavailable', summary: '검사 도구 없음' } };
    expect(planConnectedResult({ ...snapshot(), comments: [comment(wrap(JSON.stringify(r)))] }, request)).toEqual({ action: 'blocked', reason: 'test_unavailable' });
  });
  it('prepares a request without API login requirements or candidate PR instructions', () => {
    const body = buildDevelopmentRequest(request);
    expect(body).toContain(`<!-- ais-development-request-v2:${KEY} -->`);
    expect(body).toContain('GitHub API·gh 인증·댓글·push·머지는 연결된 GitHub 담당의 일');
    expect(body).toContain('failed/blocked는 비민감 code·summary 이유를 반드시');
    expect(() => buildDevelopmentRequest({ ...request, token: 'synthetic-secret' })).toThrow('invalid_fields');
    expect(() => buildDevelopmentRequest({ ...repair, allowed_paths: ['harness/event-loop.md'] })).toThrow();
  });
  it('runs through native Node without credentials, writes only a new local file and does not print input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ais-controller-'));
    try {
      const input = join(dir, 'input.json'), output = join(dir, 'output.txt');
      writeFileSync(input, JSON.stringify({ request }));
      const script = fileURLToPath(new URL('../../scripts/review/connected-controller.ts', import.meta.url));
      const args = ['--experimental-strip-types', script, 'request', input, output];
      const first = spawnSync(process.execPath, args, { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' } });
      expect(first.error, 'Native CLI child process must actually start').toBeUndefined();
      expect(first.status, first.stderr).toBe(0);
      expect(JSON.parse(first.stdout)).toMatchObject({ network_calls: 0, merge_authorized: false });
      expect(readFileSync(output, 'utf8')).toContain('<!-- ais-development-request-v2:');
      const repeat = spawnSync(process.execPath, args, { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' } });
      expect(repeat.status).toBe(1);
      writeFileSync(input, JSON.stringify({ request: { ...request, token: 'synthetic-secret' } }));
      const invalid = spawnSync(process.execPath, ['--experimental-strip-types', script, 'request', input, join(dir, 'invalid')], { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' } });
      expect(invalid.status).toBe(1);
      expect(invalid.stdout + invalid.stderr).not.toContain('synthetic-secret');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
