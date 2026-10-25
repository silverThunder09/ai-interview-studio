/** Repo-scoped App credentials and a narrow product writer. Never used for ledger or merge. */
/* global fetch, AbortSignal */
import { createPrivateKey, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { GitHub, allPages } from './event-worker.ts';

const REPO = 'silverThunder09/ai-interview-studio', SHA = /^[a-f0-9]{40}$/;
const permissions = { contents: 'write', pull_requests: 'write' };
const ensure = (value, code) => { if (!value) throw new Error(code); };
const positive = n => Number.isSafeInteger(n) && n > 0;
const safePath = p => typeof p === 'string' && /^[A-Za-z0-9_./-]+$/.test(p) && !p.split('/').some(s => !s || s === '.' || s === '..' || s === '.git') &&
  !/(^|\/)AGENTS\.md$/.test(p) && !['.github/', '.agents/', 'harness/', 'scripts/review/'].some(s => p.startsWith(s)) && !/(^|\/)(package(-lock)?\.json|\.npmrc|\.node-version|.*\.lock)$/.test(p);
const mask = value => console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);

export class AppCredentials {
  constructor({ api, appId, installationId, privateKey, request = fetch, now = Date.now, redact = mask }) {
    Object.assign(this, { api, appId, installationId, privateKey, request, now, redact });
    this.token = null; this.expires = 0;
  }
  async global(method, path, token, body) {
    let response;
    try { response = await this.request(`https://api.github.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('app_network_failed'); }
    ensure(response.ok, 'app_auth_http_failed');
    return response.status === 204 ? null : response.json();
  }
  async client() {
    if (this.token && this.expires > this.now() + 60000) return new GitHub(this.token);
    ensure(!this.token, 'app_token_expired');
    ensure(/^[1-9][0-9]*$/.test(this.appId ?? '') && /^[1-9][0-9]*$/.test(this.installationId ?? '') && typeof this.privateKey === 'string' && this.privateKey.length > 0, 'missing_pr_writer_app');
    const repo = await this.api.repository();
    ensure(repo.full_name === REPO && positive(repo.id), 'wrong_app_repository');
    this.redact(this.privateKey);
    let jwt;
    try {
      const key = createPrivateKey(this.privateKey); ensure(key.asymmetricKeyType === 'rsa', 'invalid_app_key');
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const issued = Math.floor(this.now() / 1000);
      const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: issued - 30, exp: issued + 540, iss: this.appId })}`;
      jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
    } catch { throw new Error('invalid_app_key'); }
    this.redact(jwt);
    const result = await this.global('POST', `/app/installations/${this.installationId}/access_tokens`, jwt, { repository_ids: [repo.id], permissions });
    ensure(typeof result.token === 'string' && result.token.length > 0, 'invalid_app_token');
    // Mask before any validation or API use; revoke even a rejected/overbroad response.
    this.redact(result.token); this.token = result.token;
    this.expires = Date.parse(result.expires_at);
    ensure(this.expires > this.now() + 60000 && this.expires <= this.now() + 3660000 &&
      Array.isArray(result.repositories) && result.repositories.length === 1 && result.repositories[0].id === repo.id && result.repositories[0].full_name === REPO &&
      result.permissions?.contents === 'write' && result.permissions?.pull_requests === 'write' &&
      Object.entries(result.permissions).every(([k, v]) => Object.hasOwn(permissions, k) || (k === 'metadata' && v === 'read')), 'overbroad_or_invalid_app_token');
    return new GitHub(this.token);
  }
  async dispose() {
    if (!this.token) return;
    const token = this.token; this.token = null; this.privateKey = null;
    await this.global('DELETE', '/installation/token', token);
  }
  async ready(query, variables) { await this.client(); return this.global('POST', '/graphql', this.token, { query, variables }); }
}

export class ProductWriter {
  constructor({ api, credentials, config }) { Object.assign(this, { api, credentials, config }); }
  bind({ definition, task, pr = null, main }) {
    ensure(this.config.tasks.some(d => JSON.stringify(d) === JSON.stringify(definition)) && definition.id === task.id && SHA.test(main), 'unapproved_writer_task');
    const planned = pr === null, branch = planned ? `work/${definition.id}` : pr.head.ref;
    ensure(typeof branch === 'string' && /^[A-Za-z0-9_/-]+$/.test(branch) && !branch.split('/').some(p => !p || p === '.' || p === '..') && branch !== 'main' && !branch.startsWith('automation/'), 'invalid_product_branch');
    ensure(planned ? task.pr === null && definition.pr === null : positive(task.pr) && pr.number === task.pr && (definition.pr === null || definition.pr === task.pr), 'wrong_writer_pr');
    const parent = planned ? main : pr.head.sha, trees = new Set();
    ensure(SHA.test(parent ?? ''), 'invalid_writer_parent');
    const allowed = planned ? [`.automation/requests/${definition.id}.md`] : definition.allowed_paths;
    const live = async () => {
      ensure((await this.api.request('GET', '/branches/main')).commit.sha === main, 'writer_main_changed');
      const labels = await allPages(this.api, '/issues/35/labels');
      ensure(!labels.some(l => ['needs-user', 'agent-paused'].includes(l.name)), 'writer_stopped');
      if (planned) return;
      const current = await this.api.request('GET', `/pulls/${task.pr}`);
      ensure(current.state === 'open' && current.merged === false && current.user?.login === 'silverThunder09' && current.head?.repo?.full_name === REPO && current.head.repo.fork === false && current.base?.repo?.full_name === REPO && current.base.ref === 'main' && current.head.ref === branch, 'wrong_writer_scope');
      const prLabels = await allPages(this.api, `/issues/${task.pr}/labels`);
      ensure(!prLabels.some(l => ['needs-user', 'agent-paused'].includes(l.name)), 'writer_stopped');
      ensure([parent, task.applied?.sha].filter(Boolean).includes(current.head.sha), 'writer_head_changed');
    };
    const request = async (method, path, body) => {
      // A fixed endpoint whitelist; no generic forwarding of control/sender writes.
      let kind;
      if (method === 'POST' && path === '/git/trees') {
        ensure(body && SHA.test(body.base_tree) && Array.isArray(body.tree) && body.tree.length > 0 && body.tree.length <= 10 && new Set(body.tree.map(f => f.path)).size === body.tree.length &&
          body.tree.every(f => allowed.includes(f.path) && safePath(f.path) && f.mode === '100644' && f.type === 'blob' && typeof f.content === 'string' && !Object.hasOwn(f, 'sha') && Object.keys(f).length === 4), 'unapproved_writer_files');
        ensure((await this.api.request('GET', `/git/commits/${parent}`)).tree.sha === body.base_tree, 'writer_tree_changed'); kind = 'tree';
      } else if (method === 'POST' && path === '/git/commits') {
        ensure(body && body.parents?.length === 1 && body.parents[0] === parent && trees.has(body.tree) && typeof body.message === 'string' && Object.keys(body).length === 3, 'unapproved_writer_commit'); kind = 'commit';
      } else if (planned && method === 'POST' && path === '/git/refs') {
        ensure(body?.ref === `refs/heads/${branch}` && body.sha === task.preparation?.commit && Object.keys(body).length === 2, 'unapproved_writer_ref');
        const c = await this.api.request('GET', `/git/commits/${body.sha}`);
        ensure(c.parents?.length === 1 && c.parents[0].sha === main && c.tree.sha === task.preparation.tree, 'writer_parent_changed');
      } else if (!planned && method === 'PATCH' && path === `/git/refs/heads/${branch}`) {
        ensure(body?.force === false && body.sha === task.applied?.sha && task.applied.parent === parent && Object.keys(body).length === 2, 'unapproved_writer_ref');
        ensure((await this.api.request('GET', `/git/ref/heads/${branch}`)).object.sha === parent, 'writer_parent_changed');
        const c = await this.api.request('GET', `/git/commits/${body.sha}`);
        ensure(c.parents?.length === 1 && c.parents[0].sha === parent, 'writer_parent_changed');
      } else if (!planned && method === 'POST' && path === '/merges') {
        ensure(body?.base === branch && body.head === main && Object.keys(body).every(k => ['base', 'head', 'commit_message'].includes(k)), 'unapproved_writer_merge');
        ensure((await this.api.request('GET', `/git/ref/heads/${branch}`)).object.sha === parent, 'writer_parent_changed');
      } else if (!planned && method === 'PATCH' && path === `/pulls/${task.pr}`) {
        ensure(typeof body?.body === 'string' && Object.keys(body).length === 1, 'unapproved_writer_metadata');
      } else throw new Error('unapproved_writer_operation');
      await live();
      const result = await (await this.credentials.client()).request(method, path, body);
      if (kind) { ensure(SHA.test(result?.sha ?? ''), 'invalid_writer_object'); if (kind === 'tree') trees.add(result.sha); }
      return result;
    };
    return { request, graphql: async (query, variables) => {
      ensure(!planned && query === 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}' && variables?.id === pr.node_id && typeof pr.node_id === 'string' && Object.keys(variables).length === 1, 'unapproved_writer_graphql');
      await live();
      // GitHub's repository client intentionally has no generic GraphQL forwarding.
      const response = await this.credentials.ready(query, variables);
      ensure(!response.errors, 'writer_graphql_failed'); return response;
    } };
  }
}
