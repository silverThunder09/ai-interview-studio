/** Foreground loop for a separately managed persistent host; it creates no schedule. */
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { runSupervisor } from './direct-supervisor.mjs';

const WAIT_MS = 5 * 60 * 1000;
const OBSERVE = new Set(['idle', 'leased', 'waiting-actions', 'wakeup-sent', 'wakeup-pending']);

/** Unknown outcomes stop. Continuing after a wake only rereads the existing journal. */
export async function runDaemon({ token, environment, supervise = runSupervisor, wait = delay, report = () => {} }) {
  for (;;) {
    const result = await supervise({ token, environment, report });
    report({ state: result?.state });
    if (result?.credential_cleanup || !OBSERVE.has(result?.state)) return result;
    await wait(WAIT_MS);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--env') { console.error('Usage: node scripts/review/direct-daemon.mjs --env ENV_ID'); process.exitCode = 2; }
  else runDaemon({ token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, environment: process.argv[3], report: event => console.log(JSON.stringify(event)) })
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error(JSON.stringify({ state: 'hold', reason: 'daemon_unavailable' })); process.exitCode = 1; });
}
