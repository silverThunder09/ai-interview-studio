/** Resume observation of one already recorded Cloud task; never submit work. */
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { runDirectRunner } from './direct-runner.mjs';

export async function runResultRunner({ token, environment, taskId, tick = runDirectRunner, wait = delay, report = () => {} }) {
  if (!/^task_[a-zA-Z0-9_-]+$/.test(taskId ?? '')) throw new Error('invalid_cloud_task');
  for (;;) {
    const result = await tick({ token, environment, expectedCloudTaskId: taskId });
    report({ state: result?.state });
    if (result?.credential_cleanup || !['direct-waiting', 'leased'].includes(result?.state)) return result;
    await wait(5 * 60 * 1000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 6 || process.argv[2] !== '--env' || process.argv[4] !== '--task') { console.error('Usage: node scripts/review/direct-result-runner.mjs --env ENV_ID --task TASK_ID'); process.exitCode = 2; }
  else runResultRunner({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, environment: process.argv[3], taskId: process.argv[5], report: event => console.log(JSON.stringify(event)) })
    .catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'runner_unavailable' })); process.exitCode = 1; });
}
