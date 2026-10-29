import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { runInventoryInstall } from '../../scripts/review/direct-inventory-runner.mjs';

describe('direct inventory installation entrypoint', () => {
  it('rejects missing context and a directory outside the checked-out repository', async () => {
    await expect(runInventoryInstall({ token: '' })).rejects.toThrow('missing_runner_context');
    await expect(runInventoryInstall({ token: 'synthetic', root: tmpdir() })).rejects.toThrow('wrong_runner_directory');
  });
});
