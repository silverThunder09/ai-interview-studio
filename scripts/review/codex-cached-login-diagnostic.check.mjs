import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectCachedLogin, validateCachedAuthEnvelope } from './codex-cached-login-diagnostic.mjs';

function fixture() { const calls=[]; return { calls, deps: { prepare:async()=>calls.push('prepare'), runStatus:async()=>{calls.push('status');return {stderr:'Logged in using ChatGPT\n'};}, cleanup:async()=>calls.push('cleanup') } }; }
test('recognizes cached ChatGPT login but performs no Cloud request', async () => { const f=fixture(); assert.deepEqual(await inspectCachedLogin(f.deps),{state:'cached_chatgpt',reason:'none'}); assert.deepEqual(f.calls,['prepare','status','cleanup']); });
test('classifies bad JSON without exposing CLI output', async () => { const f=fixture(); f.deps.runStatus=async()=>{throw {stderr:'Error checking login status: invalid type: sequence, expected struct AuthDotJson synthetic-secret'};}; const r=await inspectCachedLogin(f.deps);assert.deepEqual(r,{state:'login_status_unconfirmed',reason:'invalid_auth_json'});assert.equal(JSON.stringify(r).includes('synthetic-secret'),false); });
test('does not report another login mode as ChatGPT', async () => { const f=fixture();f.deps.runStatus=async()=>({stderr:'Logged in using an API key - synthetic-secret'});const r=await inspectCachedLogin(f.deps);assert.equal(r.state,'other_or_unconfirmed');assert.equal(JSON.stringify(r).includes('synthetic-secret'),false); });
test('failed preparation prevents CLI and cleans up', async () => { const f=fixture();f.deps.prepare=async()=>{throw Error('synthetic-secret')};const r=await inspectCachedLogin(f.deps);assert.equal(r.state,'setup_unconfirmed');assert.deepEqual(f.calls,['cleanup']);assert.equal(JSON.stringify(r).includes('synthetic-secret'),false); });
test('cleanup failure never reports success', async () => { const f=fixture();f.deps.cleanup=async()=>{throw Error('synthetic-secret')};const r=await inspectCachedLogin(f.deps);assert.equal(r.state,'cleanup_unconfirmed');assert.equal(JSON.stringify(r).includes('synthetic-secret'),false); });


test('checks only the envelope and rejects malformed JSON or outer arrays', () => {
  assert.equal(validateCachedAuthEnvelope('[{"auth_mode":"chatgpt"}]'), 'invalid_auth_json');
  assert.equal(validateCachedAuthEnvelope('{broken'), 'invalid_auth_json');
  assert.equal(validateCachedAuthEnvelope('{"auth_mode":"chatgpt","tokens":{"access_token":"synthetic-secret"}}'), 'chatgpt_mode');
  assert.equal(validateCachedAuthEnvelope('{"auth_mode":"apikey"}'), 'unsupported_or_legacy_mode');
  assert.equal(validateCachedAuthEnvelope('{}'), 'unsupported_or_legacy_mode');
});
