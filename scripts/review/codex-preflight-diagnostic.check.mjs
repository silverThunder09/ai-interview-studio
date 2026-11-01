import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { diagnose, DiagnosticError } from './codex-preflight-diagnostic.mjs';

function fixture() {
  const calls = [];
  return { calls, deps: {
    config: async () => { calls.push('config'); },
    grant: async () => { calls.push('grant'); return 'synthetic-token'; },
    metadata: async () => { calls.push('metadata'); return { updated_at: '2026-11-01T01:00:00Z' }; },
    failedRun: async () => ({ created_at: '2026-11-01T02:00:00Z' }),
    fileCheck: async () => { calls.push('file'); },
    revoke: async () => { calls.push('revoke'); }
  } };
}
test('reports stages but never includes token', async () => {
  const f = fixture(), result = await diagnose(f.deps);
  assert.deepEqual(f.calls, ['config', 'grant', 'metadata', 'file', 'revoke']);
  assert.equal(result.secret_metadata, 'ok'); assert.equal(result.historical_snapshot, 'current_metadata_precedes_run');
  assert.equal(JSON.stringify(result).includes('synthetic-token'), false);
});
test('a grant error does not stop independent file check', async () => {
  const f = fixture(); f.deps.grant = async () => { throw new Error('private exception'); };
  const result = await diagnose(f.deps);
  assert.equal(result.app_permission, 'unclassified'); assert.equal(result.secret_metadata, 'not_checked'); assert.equal(result.empty_file, 'ok'); assert.equal(result.token_cleanup, 'not_needed');
  assert.equal(JSON.stringify(result).includes('private exception'), false);
});
test('metadata failure revokes token and does not expose exception', async () => {
  const f = fixture(); f.deps.metadata = async () => { throw new Error('private exception'); };
  const result = await diagnose(f.deps);
  assert.equal(result.secret_metadata, 'unclassified'); assert.equal(result.token_cleanup, 'ok'); assert.equal(f.calls.at(-1), 'revoke');
});
test('cannot infer previous secret if modified after failed run', async () => {
  const f = fixture(); f.deps.metadata = async () => ({ updated_at: '2026-11-01T03:00:00Z' });
  const result = await diagnose(f.deps); assert.equal(result.historical_snapshot, 'changed_or_same_second');
});
test('failed revoke is visible and raw exception is hidden', async () => {
  const f = fixture(); f.deps.revoke = async () => { throw new Error('synthetic-token'); };
  const result = await diagnose(f.deps); assert.equal(result.token_cleanup, 'revoke_error'); assert.equal(JSON.stringify(result).includes('synthetic-token'), false);
});

test('safe HTTP categories are reported without response bodies', async () => { const f = fixture(); f.deps.grant = async () => { throw new DiagnosticError('http_403'); }; const result = await diagnose(f.deps); assert.equal(result.app_permission, 'http_403'); assert.equal(result.empty_file, 'ok'); });
test('unconfirmed cleanup of a rejected grant is never marked unnecessary', async () => { const f = fixture(); f.deps.grant = async () => { throw new DiagnosticError('revoke_error'); }; const result = await diagnose(f.deps); assert.equal(result.token_cleanup, 'revoke_error'); });
