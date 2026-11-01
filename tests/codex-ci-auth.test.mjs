import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maintainAuth, storeSecret } from '../scripts/review/codex-ci-auth.mjs';
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
