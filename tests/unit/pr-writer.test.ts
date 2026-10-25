import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { AppCredentials, ProductWriter } from '../../scripts/review/pr-writer.mjs';

const repository = 'silverThunder09/ai-interview-studio', parent = 'a'.repeat(40), main = 'b'.repeat(40), tree = 'c'.repeat(40), commit = 'd'.repeat(40);
const now = () => Date.parse('2026-10-25T07:00:00Z');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
function credentialFixture() {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [], masks: string[] = [];
  const result = { token: 'synthetic-installation-token', expires_at: '2026-10-25T08:00:00Z', permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' }, repositories: [{ id: 123, full_name: repository }] };
  const request = vi.fn(async (url: string, input: RequestInit) => {
    const body = input.body ? JSON.parse(String(input.body)) as Record<string, unknown> : undefined;
    calls.push({ url, method: input.method!, ...(body ? { body } : {}) });
    expect(input.redirect).toBe('error');
    if (input.method === 'DELETE') return new Response(null, { status: 204 });
    expect(url).toBe('https://api.github.com/app/installations/456/access_tokens');
    const jwt = (input.headers as Record<string, string>).Authorization!.slice(7), segments = jwt.split('.');
    expect(verify('RSA-SHA256', Buffer.from(segments.slice(0, 2).join('.')), keys.publicKey, Buffer.from(segments[2]!, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString()) as { iss: string; iat: number; exp: number };
    expect(claims.iss).toBe('789'); expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    return new Response(JSON.stringify(result));
  });
  const options = { api: { repository: async () => ({ id: 123, full_name: repository }) }, appId: '789', installationId: '456', privateKey, now, request, redact: (v: string) => masks.push(v) };
  return { result, calls, masks, request, options, credentials: new AppCredentials(options) };
}
describe('repository-only installation credential lifecycle', () => {
  it('signs a short JWT, requests one repository/two write scopes, masks, reuses and revokes the token', async () => {
    const f = credentialFixture(); await f.credentials.client(); await f.credentials.client();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.body).toEqual({ repository_ids: [123], permissions: { contents: 'write', pull_requests: 'write' } });
    expect(f.masks).toHaveLength(3); expect(f.masks).toContain(privateKey); expect(f.masks).toContain(f.result.token);
    await f.credentials.dispose(); await f.credentials.dispose();
    expect(f.calls.map(c => c.method)).toEqual(['POST', 'DELETE']); expect(f.calls[1]!.url).toBe('https://api.github.com/installation/token');
  });
  it.each(['repository', 'extra-repository', 'permissions', 'missing-permission', 'expired', 'long-expiry'])('rejects %s and revokes the rejected token without fallback', async kind => {
    const f = credentialFixture();
    if (kind === 'repository') f.result.repositories[0]!.full_name = 'another/repository';
    if (kind === 'extra-repository') f.result.repositories.push({ id: 321, full_name: 'another/repository' });
    if (kind === 'permissions') Object.assign(f.result.permissions, { actions: 'write' });
    if (kind === 'missing-permission') f.result.permissions.contents = 'read';
    if (kind === 'expired') f.result.expires_at = '2026-10-25T06:00:00Z';
    if (kind === 'long-expiry') f.result.expires_at = '2026-10-26T07:00:00Z';
    await expect(f.credentials.client()).rejects.toThrow('overbroad_or_invalid_app_token');
    await f.credentials.dispose(); expect(f.calls.map(c => c.method)).toEqual(['POST', 'DELETE']);
  });
  it('does not read or mint credentials before a product write and reports missing setup without network requests', async () => {
    const f = credentialFixture(); await f.credentials.dispose(); expect(f.calls).toEqual([]);
    const c = new AppCredentials({ ...f.options, privateKey: undefined });
    await expect(c.client()).rejects.toThrow('missing_pr_writer_app'); expect(f.calls).toEqual([]);
  });
  it('does not use a different repository identity or leak raw network errors', async () => {
    const f = credentialFixture();
    await expect(new AppCredentials({ ...f.options, api: { repository: async () => ({ id: 123, full_name: 'wrong/repo' }) } }).client()).rejects.toThrow('wrong_app_repository');
    await expect(new AppCredentials({ ...f.options, request: async () => { throw new Error(privateKey); } }).client()).rejects.toThrow('app_network_failed');
    expect(f.calls).toHaveLength(0);
  });
});

const definition = { id: 'approved-product', pr: 81, allowed_paths: ['src/shared/interview.ts'], approval: 'current user approval' };
function writerFixture() {
  const pr = { number: 81, node_id: 'PR_81', state: 'open', merged: false, draft: true, user: { login: 'silverThunder09' }, head: { sha: parent, ref: 'work/approved-product', repo: { full_name: repository, fork: false } }, base: { sha: main, ref: 'main', repo: { full_name: repository } } };
  let currentMain = main, ref = parent;
  const labels: { name: string }[] = [], writes: { method: string; path: string; body: unknown }[] = [];
  const api = { request: vi.fn(async (_method: string, path: string) => {
    if (path === '/branches/main') return { commit: { sha: currentMain } };
    if (path.includes('/labels?')) return labels;
    if (path === '/pulls/81') return pr;
    if (path.startsWith('/git/ref/heads/')) return { object: { sha: ref } };
    if (path.startsWith('/git/commits/')) return { tree: { sha: tree }, parents: [{ sha: path.endsWith(commit) ? parent : main }] };
    throw new Error('unexpected_read');
  }) };
  const client = vi.fn(async () => ({ request: async (method: string, path: string, body: unknown) => { writes.push({ method, path, body }); return { sha: path === '/git/trees' ? tree : commit }; } }));
  const ready = vi.fn(async () => ({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } }));
  const writer = new ProductWriter({ api, credentials: { client, ready }, config: { tasks: [definition] } });
  const task = { id: definition.id, pr: 81, applied: { parent, sha: commit } };
  const context = { definition, task, pr, main };
  return { writer, context, api, pr, labels, client, ready, writes, moveMain: () => { currentMain = commit; }, moveRef: () => { ref = commit; } };
}
describe('product write roles and live scope', () => {
  it('creates only the approved tree/one-parent commit and non-force product ref', async () => {
    const f = writerFixture(), writer = f.writer.bind(f.context);
    await writer.request('POST', '/git/trees', { base_tree: tree, tree: [{ path: definition.allowed_paths[0], mode: '100644', type: 'blob', content: 'approved change' }] });
    await writer.request('POST', '/git/commits', { parents: [parent], tree, message: 'fix: approved change' });
    await writer.request('PATCH', '/git/refs/heads/work/approved-product', { sha: commit, force: false });
    expect(f.writes.map(w => w.path)).toEqual(['/git/trees', '/git/commits', '/git/refs/heads/work/approved-product']);
    expect(f.api.request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });
  it.each(['/git/refs/heads/main', '/git/refs/heads/automation/approved-loop', '/pulls', '/pulls/81/merge', '/pulls/81/reviews', '/issues/81/comments', '/actions/workflows/ci.yml/dispatches', '/actions/secrets'])('rejects a different role endpoint %s before minting', async path => {
    const f = writerFixture(); await expect(f.writer.bind(f.context).request('POST', path, {})).rejects.toThrow('unapproved_writer_operation'); expect(f.client).not.toHaveBeenCalled();
  });
  it.each(['.github/workflows/ci.yml', '../escape', '/tmp/escape', 'src/shared/AGENTS.md', 'package.json', 'src/shared/unapproved.ts'])('rejects unapproved file %s', async path => {
    const f = writerFixture();
    await expect(f.writer.bind(f.context).request('POST', '/git/trees', { base_tree: tree, tree: [{ path, mode: '100644', type: 'blob', content: 'x' }] })).rejects.toThrow('unapproved_writer_files'); expect(f.client).not.toHaveBeenCalled();
  });
  it.each(['main', 'fork', 'author', 'label', 'head', 'ref'])('rejects live %s drift before using the App', async change => {
    const f = writerFixture(), writer = f.writer.bind(f.context);
    if (change === 'main') f.moveMain(); if (change === 'fork') f.pr.head.repo.fork = true;
    if (change === 'author') f.pr.user.login = 'app[bot]'; if (change === 'label') f.labels.push({ name: 'needs-user' });
    if (change === 'head') f.pr.head.sha = 'e'.repeat(40); if (change === 'ref') f.moveRef();
    await expect(writer.request('PATCH', '/git/refs/heads/work/approved-product', { sha: commit, force: false })).rejects.toThrow(); expect(f.client).not.toHaveBeenCalled();
  });
  it('rejects force pushes, arbitrary commits, metadata and GraphQL mutations', async () => {
    const f = writerFixture(), writer = f.writer.bind(f.context);
    for (const [method, path, body] of [
      ['PATCH', '/git/refs/heads/work/approved-product', { sha: commit, force: true }],
      ['POST', '/git/commits', { parents: [parent], tree, message: 'unattested tree' }],
      ['POST', '/merges', { base: 'main', head: parent }],
      ['PATCH', '/pulls/81', { body: 'x', base: 'main' }],
    ] as const) await expect(writer.request(method, path, body)).rejects.toThrow();
    await expect(writer.graphql('mutation{mergePullRequest{}}', {})).rejects.toThrow(); expect(f.client).not.toHaveBeenCalled();
  });
  it('uses the writer for normal main merge, body and exact-node ready; leaves the author intact', async () => {
    const f = writerFixture(), writer = f.writer.bind(f.context);
    await writer.request('POST', '/merges', { base: f.pr.head.ref, head: main, commit_message: 'merge main' });
    await writer.request('PATCH', '/pulls/81', { body: 'validated template body' });
    await writer.graphql('mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}', { id: 'PR_81' });
    expect(f.ready).toHaveBeenCalledOnce(); expect(f.pr.user.login).toBe('silverThunder09'); expect(f.writes).toHaveLength(2);
  });
  it('does not fall back to the control or sender when App setup/auth fails', async () => {
    const f = writerFixture(); f.client.mockRejectedValue(new Error('missing_pr_writer_app'));
    await expect(f.writer.bind(f.context).request('PATCH', '/pulls/81', { body: 'x' })).rejects.toThrow('missing_pr_writer_app');
    expect(f.writes).toEqual([]); expect(f.api.request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  });
});
