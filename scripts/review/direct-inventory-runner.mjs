/** Install the user-approved historical cutoff from a clean trusted main. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { REPO, RuntimeAPI, LoopStore, parseLoopConfig } from './loop-coordinator.mjs';
import { validateDirectContext } from './direct-tick.mjs';
import { installDirectInventory } from './direct-history.mjs';

const exec = promisify(execFile), SHA = /^[a-f0-9]{40}$/;
const ensure = (value, code) => { if (!value) throw new Error(code); };
async function git(args) { return (await exec('git', args, { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim(); }

export async function runInventoryInstall({ token, root = process.cwd() }) {
  ensure(typeof token === 'string' && token.length > 0, 'missing_runner_context');
  const rootPath = await realpath(root), gitRoot = await realpath(await git(['rev-parse', '--show-toplevel']));
  ensure(rootPath === gitRoot && await realpath(process.cwd()) === rootPath, 'wrong_runner_directory');
  const head = await git(['rev-parse', '--verify', 'HEAD']);
  ensure(SHA.test(head) && (await git(['status', '--porcelain=v1', '--untracked-files=no'])) === '', 'untrusted_runner_checkout');
  const api = new RuntimeAPI(token), repo = await api.repository();
  ensure(repo?.full_name === REPO && (await api.request('GET', '/branches/main')).commit.sha === head, 'trusted_main_moved');
  const config = parseLoopConfig(JSON.parse(await readFile('.github/approved-loop.json', 'utf8')));
  const policy = JSON.parse(await readFile('.github/review-policy.json', 'utf8'));
  validateDirectContext(config, policy);
  ensure(config.direct_history_cutoff, 'missing_direct_cutoff');
  return installDirectInventory({ api, store: new LoopStore(api, config), config, expectedMain: head });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--apply') { console.error('Usage: node scripts/review/direct-inventory-runner.mjs --apply'); process.exitCode = 2; }
  else runInventoryInstall({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ state: 'hold', reason: /^[a-z0-9_]+$/.test(error?.message ?? '') ? error.message : 'runner_unavailable' })); process.exitCode = 1; });
}
