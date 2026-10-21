import { expect, it } from 'vitest';
import { summarizeTrace } from '../../scripts/review/smoke-diagnostics.mjs';
it('shows an unfinished call without printing arguments, selectors, keys or error text', () => {
  const trace = [
    { type: 'before', callId: '1', apiName: 'locator.fill', method: 'fill', params: { value: 'synthetic-private-key', selector: 'private-selector' } },
    { type: 'after', callId: '1', error: { message: 'private-path-or-text' } },
    { type: 'before', callId: '2', apiName: 'electronApplication.close', method: 'close' },
  ].map(x => JSON.stringify(x)).join('\n');
  expect(summarizeTrace(trace)).toEqual([{ api: 'locator.fill', method: 'fill', finished: true, error: true }, { api: 'electronApplication.close', method: 'close', finished: false, error: false }]);
  expect(JSON.stringify(summarizeTrace(trace))).not.toMatch(/synthetic-private|private-selector|private-path/);
});
it('omits arbitrary names, malformed records and control characters', () => {
  const trace = 'broken\nnull\n' + JSON.stringify({ type: 'before', callId: '1', apiName: 'key=synthetic-secret\n', method: '../path' });
  expect(summarizeTrace(trace)).toEqual([{ api: 'unknown', method: 'unknown', finished: false, error: false }]);
});
