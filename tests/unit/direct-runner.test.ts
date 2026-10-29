import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDirectRunner } from '../../scripts/review/direct-runner.mjs';

describe('direct runner trust boundary', () => {
  it('rejects missing access and invalid environment identifiers before network access', async () => {
    await expect(runDirectRunner({ token: '', environment: 'env_1' })).rejects.toThrow('missing_runner_context');
    await expect(runDirectRunner({ token: 'synthetic', environment: '../other' })).rejects.toThrow('missing_runner_context');
  });
  it('rejects a directory other than the repository root before contacting GitHub', async () => {
    await expect(runDirectRunner({ token: 'synthetic', environment: 'env_1', root: dirname(process.cwd()) })).rejects.toThrow('wrong_runner_directory');
  });
});
