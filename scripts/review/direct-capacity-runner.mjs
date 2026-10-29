/** Keep one unsubmitted approved request waiting for officially available capacity. */
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { runDirectRunner } from './direct-runner.mjs';

const KEY = /^[a-f0-9]{64}$/;
const INTERVAL_MS = 5 * 60 * 1000;

/**
 * This is a foreground process, not a scheduler. It never infers a reset time,
 * repeats an attempted submission, or retries an error. Only an explicit
 * capacity limit on an untouched request permits another read-only check.
 */
export async function runCapacityRunner({ token, environment, tick = runDirectRunner, wait = delay, report = () => {} }) {
  let expectedRequestKey;
  for (;;) {
    const result = await tick({ token, environment, expectedRequestKey });
    report({ state: result?.state, ...(result?.reason ? { reason: result.reason } : {}) });
    if (result?.credential_cleanup || result?.state !== 'limits-hold' || result.reason !== 'limited' || !KEY.test(result.request_key ?? '')) return result;
    if (expectedRequestKey !== undefined && result.request_key !== expectedRequestKey) return { state: 'resumption-hold' };
    expectedRequestKey = result.request_key;
    await wait(INTERVAL_MS);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--env') { console.error('Usage: node scripts/review/direct-capacity-runner.mjs --env ENV_ID'); process.exitCode = 2; }
  else runCapacityRunner({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, environment: process.argv[3], report: event => console.log(JSON.stringify(event)) })
    .catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'runner_unavailable' })); process.exitCode = 1; });
}
