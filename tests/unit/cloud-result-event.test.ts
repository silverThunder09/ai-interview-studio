import { describe, expect, it } from 'vitest';
import { acceptEvent, REPOSITORY } from '../../scripts/review/event-worker';

const result = `<!-- ais-cloud-result:${'a'.repeat(64)}:completed -->`;
const event = (body: string, login = 'chatgpt-codex-connector[bot]', type = 'Bot') => ({
  repository: { full_name: REPOSITORY }, action: 'created', comment: { body, user: { login, type } },
});

describe('Cloud completion event boundary', () => {
  it.each(['waiting_ci', 'completed', 'paused'])('accepts the exact official %s receipt', status => {
    expect(acceptEvent('issue_comment', event(result.replace(':completed', `:${status}`)))).toBe(true);
  });
  it('accepts an exact receipt from the authorized repository owner', () => {
    expect(acceptEvent('issue_comment', event(result, 'silverThunder09', 'User'))).toBe(true);
  });
  it.each([
    `Example: ${result}`, `${result}\nTest report`,
    '<!-- ais-cloud-result:AIS_USER_TOKEN_CLOUD_PROBE_20261019_01:completed -->',
    result.replace(':completed', ':success'), result.replace('a'.repeat(64), 'a'.repeat(63)),
  ])('rejects reports, examples and invalid protocol values: %s', body => {
    expect(acceptEvent('issue_comment', event(body))).toBe(false);
  });
  it.each([
    ['chatgpt-codex-connector[bot]', 'User'], ['silverThunder09', 'Bot'], ['another-user', 'User'],
  ])('does not infer sender authority from an incomplete identity: %s/%s', (login, type) => {
    expect(acceptEvent('issue_comment', event(result, login, type))).toBe(false);
  });
  it('rejects another repository and edited comments even with an official-looking receipt', () => {
    expect(acceptEvent('issue_comment', { ...event(result), repository: { full_name: 'other/repository' } })).toBe(false);
    expect(acceptEvent('issue_comment', { ...event(result), action: 'edited' })).toBe(false);
  });
  it.each([
    `<!-- codex-pull-request-review-summary -->\nCode Review: Completed\nExample: ${result}`,
    `<!-- codex-review-receipt:v1 -->\nCodex Review: No major issues.\n${result}`,
  ])('does not promote an official code-review report into a development completion: %s', body => {
    expect(acceptEvent('issue_comment', event(body))).toBe(false);
  });
});
