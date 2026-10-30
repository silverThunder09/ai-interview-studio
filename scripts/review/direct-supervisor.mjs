/** Foreground supervisor: recover an existing receipt before considering new work. */
import { pathToFileURL } from 'node:url';
import { readRecordedCloudTask } from './direct-runner.mjs';
import { runCapacityRunner } from './direct-capacity-runner.mjs';
import { runResultRunner } from './direct-result-runner.mjs';

export async function runSupervisor({ token, environment, discover = readRecordedCloudTask, capacity = runCapacityRunner, resultRunner = runResultRunner, report = () => {} }) {
  const recorded = await discover({ token });
  if (recorded.state === 'hold') return { state: 'resumption-hold' };
  if (recorded.state === 'processing') return { state: 'waiting-actions' };
  if (recorded.state === 'sent') return resultRunner({ token, environment, taskId: recorded.task_id, report });
  if (recorded.state !== 'none') return { state: 'resumption-hold' };
  const result = await capacity({ token, environment, report });
  if (result?.state !== 'sent') return result;
  return resultRunner({ token, environment, taskId: result.task_id, report });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--env') { console.error('Usage: node scripts/review/direct-supervisor.mjs --env ENV_ID'); process.exitCode = 2; }
  else runSupervisor({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, environment: process.argv[3], report: event => console.log(JSON.stringify(event)) })
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'supervisor_unavailable' })); process.exitCode = 1; });
}
