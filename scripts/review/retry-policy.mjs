/** Pure scheduling policy. A caller must independently authenticate the terminal receipt. */
const KEY = /^[a-f0-9]{64}$/;
const DELAYS_MS = [6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000];
const RETRYABLE = new Set(['rate_limit', 'temporary_unavailable']);
const stamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) && new Date(n).toISOString() === value ? n : null;
};

/** Return a decision only for an already-authenticated, uniquely correlated terminal failure. */
export function planRetry(input, now) {
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(now) || now < 0) return { action: 'hold', reason: 'invalid_retry_state' };
  if (input.stopped !== false) return { action: 'hold', reason: 'stopped_or_unknown' };
  if (input.receipt_verified !== true || input.terminal !== true || input.correlated !== true || !KEY.test(input.request_key ?? '')) return { action: 'hold', reason: 'unverified_terminal_receipt' };
  if (!RETRYABLE.has(input.code)) return { action: 'hold', reason: 'non_transient_or_unknown' };
  const first = stamp(input.first_failure_at);
  if (first === null || first > now || !Array.isArray(input.attempts) || input.attempts.length > 3) return { action: 'hold', reason: 'invalid_retry_history' };
  const seen = new Set([input.request_key]); let previous = first;
  for (let i = 0; i < input.attempts.length; i++) {
    const attempt = input.attempts[i], at = stamp(attempt?.requested_at);
    if (!KEY.test(attempt?.request_key ?? '') || seen.has(attempt.request_key) || at === null || at < previous || at < first + DELAYS_MS[i] || at > now || attempt.terminal !== true || attempt.correlated !== true || !RETRYABLE.has(attempt.code)) return { action: 'hold', reason: 'invalid_or_unfinished_attempt' };
    seen.add(attempt.request_key); previous = at;
  }
  if (input.attempts.length === DELAYS_MS.length) return { action: 'hold', reason: 'retry_limit' };
  const due = first + DELAYS_MS[input.attempts.length];
  if (!Number.isSafeInteger(due)) return { action: 'hold', reason: 'invalid_retry_history' };
  return now < due ? { action: 'wait', due_at: new Date(due).toISOString() } : { action: 'retry', due_at: new Date(due).toISOString() };
}
