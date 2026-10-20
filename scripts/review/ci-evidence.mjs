import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function createCIEvidence(event, env, checkoutSha, parents) {
  const input = event.inputs;
  const pr = event.pull_request ?? (input && /^[1-9][0-9]*$/.test(input.pr ?? '')
    ? { number: Number(input.pr), head: { sha: input.head }, base: { sha: input.base } } : null);
  if (!pr) return null;
  if (!/^[a-f0-9]{40}$/.test(checkoutSha) || parents[0] !== pr.base.sha || parents[1] !== pr.head.sha || parents.length !== 2) {
    throw new Error('Checkout does not match the PR head/base merge');
  }
  return { repository: env.GITHUB_REPOSITORY, context: env.GITHUB_JOB,
    run_id: env.GITHUB_RUN_ID, pr_number: pr.number, head_sha: pr.head.sha,
    base_sha: pr.base.sha, checkout_sha: checkoutSha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const sha = git(['rev-parse', 'HEAD']);
  const parents = git(['show', '-s', '--format=%P', 'HEAD']).split(' ');
  const evidence = createCIEvidence(event, process.env, sha, parents);
  if (evidence) console.log(`AIS_CI_EVIDENCE ${JSON.stringify(evidence)}`);
}
