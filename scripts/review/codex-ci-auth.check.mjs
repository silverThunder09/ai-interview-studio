import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maintainAuth, storeSecret, seedPredatesRun, classifyCliFailure, inspectCloudLogin } from './codex-ci-auth.mjs';
test('preflight failure blocks CLI and persistence', async () => { const events=[]; const result=await maintainAuth({prepare:async()=>{events.push('prepare');throw Error()},probe:async()=>events.push('probe'),persist:async()=>events.push('persist'),cleanup:async()=>events.push('cleanup')}); assert.equal(result,'preflight_failed');assert.deepEqual(events,['prepare','cleanup']); });
test('failed probe still saves possible rotated credentials', async () => { const events=[]; const result=await maintainAuth({prepare:async()=>events.push('prepare'),probe:async()=>{events.push('probe');throw Error()},persist:async()=>events.push('persist'),cleanup:async()=>events.push('cleanup')});assert.equal(result,'cloud_list_unconfirmed');assert.deepEqual(events,['prepare','probe','persist','cleanup']); });
test('failed writeback or cleanup never reports success', async () => { const common={prepare:async()=>{},probe:async()=>true,persist:async()=>{},cleanup:async()=>{}};assert.equal(await maintainAuth({...common,persist:async()=>{throw Error()}}),'writeback_unconfirmed');assert.equal(await maintainAuth({...common,cleanup:async()=>{throw Error()}}),'cleanup_unconfirmed');assert.equal(await maintainAuth(common),'cloud_list_ok'); });


test('secret write streams a file over stdin to gh without placing content in arguments', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'ais-ci-auth-test-'));
  try {
    const executable = join(directory, 'gh-fake');
    const source = join(directory, 'input');
    const captured = join(directory, 'captured');
    const args = join(directory, 'args');
    await writeFile(source, 'synthetic-only');
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\ncat > '${captured}'\n`, { mode: 0o700 });
    await storeSecret(source, 'synthetic-token', executable);
    assert.equal(await readFile(captured, 'utf8'), 'synthetic-only');
    assert.deepEqual((await readFile(args, 'utf8')).trim().split('\n'), ['secret', 'set', 'AIS_CODEX_AUTH_JSON', '--repo', 'silverThunder09/ai-interview-studio']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('queued jobs refuse a secret changed after or during the queue timestamp', () => { assert.equal(seedPredatesRun('2026-10-30T10:00:00Z','2026-10-30T10:00:01Z'),true); assert.equal(seedPredatesRun('2026-10-30T10:00:01Z','2026-10-30T10:00:01Z'),false); assert.equal(seedPredatesRun('2026-10-30T10:00:02Z','2026-10-30T10:00:01Z'),false); assert.equal(seedPredatesRun('bad','2026-10-30T10:00:01Z'),false); });


test('login failure is classified without attempting Cloud list', async () => {
  const calls = [];
  const result = await inspectCloudLogin(async args => { calls.push(args); throw { stderr: 'Not logged in synthetic-private-token' }; });
  assert.deepEqual(calls, [['login', 'status']]);
  assert.deepEqual(result, { stage: 'login_status', outcome: 'unconfirmed', reason: 'not_logged_in' });
  assert.equal(JSON.stringify(result).includes('synthetic-private-token'), false);
});

test('Cloud list failure is distinguished from a successful login status', async () => {
  const calls = [];
  const result = await inspectCloudLogin(async args => { calls.push(args); if (args[0] === 'cloud') throw { stderr: 'HTTP 401 synthetic-private-token' }; });
  assert.equal(calls.length, 2);
  assert.deepEqual(result, { stage: 'cloud_list', outcome: 'unconfirmed', reason: 'http_401' });
  assert.equal(JSON.stringify(result).includes('synthetic-private-token'), false);
});

test('unknown CLI errors never reveal their text or become success', async () => {
  assert.equal(classifyCliFailure({ stderr: 'private synthetic value' }), 'unclassified');
  const result = await inspectCloudLogin(async () => { throw { stderr: 'private synthetic value' }; });
  assert.equal(result.reason, 'unclassified');
  assert.equal(result.outcome, 'unconfirmed');
  assert.equal(JSON.stringify(result).includes('private synthetic value'), false);
});

test('successful login and Cloud list report success', async () => {
  assert.deepEqual(await inspectCloudLogin(async () => {}), { stage: 'cloud_list', outcome: 'ok', reason: 'none' });
});


test('auth JSON parser failures are classified without including their content', () => {
  assert.equal(classifyCliFailure({ stderr: 'Error checking login status: invalid type: sequence, expected struct AuthDotJson at line 1 column 1 synthetic-secret' }), 'invalid_auth_json');
  assert.equal(classifyCliFailure({ stderr: 'Error checking login status: expected value at line 1 column 1' }), 'invalid_auth_json');
  assert.equal(classifyCliFailure({ stderr: 'Not signed in. Please run codex login' }), 'not_logged_in');
  assert.equal(classifyCliFailure({ code: 'ENOENT' }), 'cli_unavailable');
  assert.equal(classifyCliFailure({ stderr: 'untrusted string: invalid type: sequence synthetic-secret' }), 'unclassified');
});
