import { describe, expect, it } from 'vitest';
import { planRetry } from '../../scripts/review/retry-policy.mjs';

const start = Date.parse('2026-10-27T00:00:00.000Z');
const hour = 60 * 60 * 1000;
const at = (n: number) => new Date(start + n * hour).toISOString();
const valid = () => ({ stopped: false, receipt_verified: true, terminal: true, correlated: true, request_key: 'a'.repeat(64), code: 'rate_limit', first_failure_at: at(0), attempts: [] as { request_key: string; requested_at: string; terminal: boolean; correlated: boolean; code: string }[] });

describe('bounded transient retry decisions', () => {
  it('waits 6 hours, 24 hours and 7 days after the first failure, then stops after three attempts', () => {
    const state = valid();
    expect(planRetry(state, start + 5 * hour)).toEqual({ action: 'wait', due_at: at(6) });
    expect(planRetry(state, start + 6 * hour)).toEqual({ action: 'retry', due_at: at(6) });
    state.attempts.push({ request_key: 'b'.repeat(64), requested_at: at(6), terminal: true, correlated: true, code: 'temporary_unavailable' });
    expect(planRetry(state, start + 23 * hour)).toEqual({ action: 'wait', due_at: at(24) });
    expect(planRetry(state, start + 24 * hour)).toEqual({ action: 'retry', due_at: at(24) });
    state.attempts.push({ request_key: 'c'.repeat(64), requested_at: at(24), terminal: true, correlated: true, code: 'rate_limit' });
    expect(planRetry(state, start + 167 * hour)).toEqual({ action: 'wait', due_at: at(168) });
    expect(planRetry(state, start + 168 * hour)).toEqual({ action: 'retry', due_at: at(168) });
    state.attempts.push({ request_key: 'd'.repeat(64), requested_at: at(168), terminal: true, correlated: true, code: 'rate_limit' });
    expect(planRetry(state, start + 200 * hour)).toEqual({ action: 'hold', reason: 'retry_limit' });
  });
  it('never retries absent, ambiguous, unauthenticated or non-transient outcomes', () => {
    for (const change of [{ stopped: true }, { stopped: undefined }, { receipt_verified: false }, { terminal: false }, { correlated: false }, { code: 'authentication' }, { code: 'unknown' }, { first_failure_at: 'bad' }, { request_key: 'bad' }]) {
      expect(planRetry({ ...valid(), ...change }, start + 200 * hour).action).toBe('hold');
    }
    expect(planRetry(null, start)).toEqual({ action: 'hold', reason: 'invalid_retry_state' });
  });
  it('rejects duplicate keys, premature attempts and unfinished or uncorrelated results', () => {
    for (const attempt of [
      { request_key: 'a'.repeat(64), requested_at: at(6), terminal: true, correlated: true, code: 'rate_limit' },
      { request_key: 'b'.repeat(64), requested_at: at(5), terminal: true, correlated: true, code: 'rate_limit' },
      { request_key: 'b'.repeat(64), requested_at: at(6), terminal: false, correlated: true, code: 'rate_limit' },
      { request_key: 'b'.repeat(64), requested_at: at(6), terminal: true, correlated: false, code: 'rate_limit' },
    ]) expect(planRetry({ ...valid(), attempts: [attempt] }, start + 200 * hour)).toEqual({ action: 'hold', reason: 'invalid_or_unfinished_attempt' });
  });
});
