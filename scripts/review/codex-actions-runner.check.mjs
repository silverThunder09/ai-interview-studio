import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { oneTick, safeRunnerResult } from './codex-actions-runner.mjs';

test('existing receipt is resumed with the exact recorded task, not submitted anew', async () => {
  const seen = [];
  const result = await oneTick({ token: 'synthetic', environment: 'synthetic', appPrivateKey: 'synthetic', discover: async () => ({ state: 'sent', task_id: 'task_example' }), tick: async input => { seen.push(input); return { state: 'direct-waiting' }; } });
  assert.equal(result.state, 'direct-waiting');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].expectedCloudTaskId, 'task_example');
});
test('an uncertain receipt and in-progress downstream work never invoke the runner', async () => {
  for (const [input, expected] of [['hold', 'resumption-hold'], ['processing', 'waiting-actions'], ['unknown', 'resumption-hold']]) {
    let calls = 0;
    const result = await oneTick({ token: 'synthetic', environment: 'synthetic', discover: async () => ({ state: input }), tick: async () => { calls++; } });
    assert.equal(result.state, expected); assert.equal(calls, 0);
  }
});
test('a malformed recorded task cannot fall through to a fresh submission', async () => {
  let calls = 0;
  const result = await oneTick({ token: 'synthetic', environment: 'synthetic', discover: async () => ({ state: 'sent', task_id: null }), tick: async () => { calls++; } });
  assert.equal(result.state, 'resumption-hold'); assert.equal(calls, 0);
});
test('a failed ledger read never starts a fresh tick', async () => {
  let calls = 0;
  await assert.rejects(oneTick({ token: 'synthetic', environment: 'synthetic', discover: async () => { throw new Error('ledger_unavailable'); }, tick: async () => { calls++; } }), /ledger_unavailable/);
  assert.equal(calls, 0);
});
test('only an absent recorded receipt permits the normal guarded runner', async () => {
  let calls = 0;
  const result = await oneTick({ token: 'synthetic', environment: 'synthetic', discover: async () => ({ state: 'none' }), tick: async input => { calls++; assert.equal(input.expectedCloudTaskId, undefined); return { state: 'idle' }; } });
  assert.equal(result.state, 'idle'); assert.equal(calls, 1);
});
test('reports confirmed usage limits without leaking raw failures or treating failed persistence as success', () => {
  assert.deepEqual(safeRunnerResult('cloud_list_ok', { state: 'limits-hold', reason: 'limited' }), { state: 'limits-hold', auth_lifecycle: 'saved', reason: 'limited' });
  assert.deepEqual(safeRunnerResult('writeback_unconfirmed', { state: 'sent', task_id: 'task_private' }), { state: 'hold', auth_lifecycle: 'writeback_unconfirmed' });
  assert.equal(JSON.stringify(safeRunnerResult('cloud_list_ok', { state: 'limits-hold', reason: 'synthetic-private-token' })).includes('synthetic-private-token'), false);
});
