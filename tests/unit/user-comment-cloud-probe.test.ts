import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/user-comment-cloud-probe.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n {10}JS/)?.[1]?.replace(/^ {10}/gm, '');
if (!script) throw new Error('Missing probe script');
const execute = new Function('return Object.getPrototypeOf(async function () {}).constructor')() as new (...args: string[]) => (process: unknown, fetch: unknown, console: unknown) => Promise<void>;
const repository = 'silverThunder09/ai-interview-studio';
const head = '0fd3a46450600069602f4a8fab9b7ba82b9880ae';

function fixture() {
  const env: Record<string, string | undefined> = { GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', AIS_CODEX_COMMENT_TOKEN: 'synthetic-probe-token' };
  const pr = { state: 'open', draft: true, merged: false, user: { login: 'silverThunder09' }, head: { sha: head, repo: { full_name: repository, fork: false } }, base: { ref: 'main', repo: { full_name: repository } } };
  let labels = [{ name: 'needs-user' }];
  const comments: { id: number; body: string; user: { login: string; type: string } }[] = [];
  const log = vi.fn();
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(url.startsWith(`https://api.github.com/repos/${repository}/`)).toBe(true);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer synthetic-probe-token');
    const path = new URL(url).pathname.replace(`/repos/${repository}`, '');
    if (path === '/pulls/45' && init.method === 'GET') return Response.json(pr);
    if (path === '/issues/45/labels' && init.method === 'GET') return Response.json(labels);
    if (path === '/issues/45/comments' && init.method === 'GET') return Response.json(comments);
    if (path === '/issues/45/comments' && init.method === 'POST') {
      const sent = { id: 123, body: (JSON.parse(String(init.body)) as { body: string }).body, user: { login: 'silverThunder09', type: 'User' } };
      comments.push(sent); return Response.json(sent, { status: 201 });
    }
    throw new Error('Unexpected probe API operation');
  });
  return { env, pr, comments, log, fetcher, removeBlock: () => { labels = []; }, run: () => new execute('process', 'fetch', 'console', script!)({ env }, fetcher, { log }) };
}

describe('isolated user comment Cloud probe', () => {
  it('delivers one fixed request to the scoped PR and skips a second POST', async () => {
    const f = fixture(); await f.run(); await f.run();
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]!.body.split('\n')[1]).toMatch(/^@codex /);
    expect(f.comments[0]!.body).toContain('AIS_USER_TOKEN_CLOUD_PROBE_20261019_01');
    expect(f.fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('synthetic-probe-token');
  });
  it('fails before network access when the secret or main context is missing', async () => {
    for (const field of ['AIS_CODEX_COMMENT_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_REF']) {
      const f = fixture(); delete f.env[field];
      await expect(f.run()).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
  it('rejects a changed head, fork, non-Draft, or closed PR without sending', async () => {
    for (const mutate of [(f: ReturnType<typeof fixture>) => { f.pr.head.sha = 'a'.repeat(40); }, (f: ReturnType<typeof fixture>) => { f.pr.head.repo.fork = true; }, (f: ReturnType<typeof fixture>) => { f.pr.draft = false; }, (f: ReturnType<typeof fixture>) => { f.pr.state = 'closed'; }]) {
      const f = fixture(); mutate(f); await expect(f.run()).rejects.toThrow('identity mismatch'); expect(f.comments).toHaveLength(0);
    }
  });
  it('requires the worker blocking label before sending', async () => {
    const f = fixture(); f.removeBlock(); await expect(f.run()).rejects.toThrow('Automatic dispatch must be blocked'); expect(f.comments).toHaveLength(0);
  });
  it('refuses to repost when a previous request has a different author or body', async () => {
    for (const field of ['author', 'body', 'duplicate']) {
      const f = fixture(); await f.run();
      if (field === 'author') f.comments[0]!.user.login = 'github-actions[bot]';
      if (field === 'body') f.comments[0]!.body += '\nmodified';
      if (field === 'duplicate') f.comments.push({ ...f.comments[0]! });
      await expect(f.run()).rejects.toThrow('Ambiguous prior probe comment');
      expect(f.fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    }
  });
  it('does not retry a rejected API request or include its body in errors', async () => {
    const f = fixture(); f.fetcher.mockImplementationOnce(async () => new Response('synthetic-private-response', { status: 403 }));
    await expect(f.run()).rejects.toThrow('HTTP 403'); expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('synthetic-private-response');
  });
  it('does not accept a bot token as a successful user delivery', async () => {
    const f = fixture(); const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => init.method === 'POST' ? Response.json({ id: 123, body: (JSON.parse(String(init.body)) as { body: string }).body, user: { login: 'github-actions[bot]', type: 'Bot' } }, { status: 201 }) : original(url, init));
    await expect(f.run()).rejects.toThrow('Probe sender or receipt mismatch');
    expect(f.fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  it('finds a prior delivery on the second page instead of posting again', async () => {
    const f = fixture(); await f.run(); f.fetcher.mockClear();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => {
      if (new URL(url).pathname.endsWith('/comments') && init.method === 'GET') return Response.json(new URL(url).searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, id) => ({ id, body: 'ordinary synthetic comment' })) : f.comments);
      return original(url, init);
    });
    await f.run(); expect(f.fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0);
  });
  it('refuses incomplete pagination before any POST', async () => {
    const f = fixture(); const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => new URL(url).pathname.endsWith('/comments') && init.method === 'GET' ? Response.json(Array.from({ length: 100 }, () => ({ body: 'ordinary synthetic comment' }))) : original(url, init));
    await expect(f.run()).rejects.toThrow('Incomplete fixed probe pagination');
    expect(f.fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0);
  });
  it('replaces malformed API JSON with a fixed error without leaking the response', async () => {
    const f = fixture(); f.fetcher.mockImplementationOnce(async () => new Response('synthetic-private-response', { status: 200 }));
    await expect(f.run()).rejects.toThrow('Invalid fixed probe API JSON'); expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('synthetic-private-response');
  });
});
