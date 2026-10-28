/** Read-only diagnostics. No result authorizes a Cloud submission or a merge. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout, clearTimeout } from 'node:timers';

const exec = promisify(execFile);
const TASK_ID = /^task_[a-zA-Z0-9_-]+$/;
const STATES = new Set(['ready', 'error', 'pending', 'running', 'queued', 'cancelled']);

export async function readTaskPages(run, maxPages = 50) {
  const seen = new Set(), tasks = [], cursors = new Set(); let cursor;
  for (let page = 0; page < maxPages; page++) {
    const raw = await run(['cloud', 'list', '--json', '--limit', '20', ...(cursor ? ['--cursor', cursor] : [])]);
    let data; try { data = JSON.parse(raw); } catch { throw new Error('invalid_cloud_list'); }
    if (!data || !Array.isArray(data.tasks) || data.tasks.length > 20) throw new Error('invalid_cloud_list');
    for (const task of data.tasks) {
      if (!task || !TASK_ID.test(task.id ?? '') || typeof task.status !== 'string' || seen.has(task.id)) throw new Error('invalid_cloud_task');
      if (task.environment_id !== undefined && task.environment_id !== null && typeof task.environment_id !== 'string') throw new Error('invalid_cloud_task');
      if (task.attempt_total !== undefined && task.attempt_total !== null && (!Number.isSafeInteger(task.attempt_total) || task.attempt_total < 0)) throw new Error('invalid_cloud_task');
      seen.add(task.id);
      tasks.push({ id: task.id, status: task.status, known_status: STATES.has(task.status),
        ...(task.environment_id !== undefined ? { environment_id: task.environment_id } : {}),
        ...(task.attempt_total !== undefined ? { attempt_total: task.attempt_total } : {}) });
    }
    if (data.cursor == null || data.cursor === '') return tasks;
    if (typeof data.cursor !== 'string' || cursors.has(data.cursor)) throw new Error('invalid_cloud_cursor');
    cursor = data.cursor; cursors.add(cursor);
  }
  throw new Error('cloud_list_incomplete');
}

/** App server supplies official rate-limit values; missing buckets are not guessed. */
export async function readLimits() {
  return await new Promise((resolve, reject) => {
    const p = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const lines = createInterface({ input: p.stdout }); let finished = false;
    const timer = setTimeout(() => done(new Error('rate_limits_timeout')), 15000);
    function done(error, value) {
      if (finished) return; finished = true; clearTimeout(timer); lines.close(); p.kill();
      if (error) reject(error); else resolve(value);
    }
    function send(value) { p.stdin.write(`${JSON.stringify(value)}\n`); }
    p.on('error', () => done(new Error('app_server_unavailable')));
    p.on('exit', () => done(new Error('app_server_stopped')));
    p.stdin.on('error', () => done(new Error('app_server_unavailable')));
    lines.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return done(new Error('invalid_app_server_response')); }
      if (msg.id === 1) {
        if (msg.error || !msg.result) return done(new Error('app_server_initialize_failed'));
        send({ method: 'initialized', params: {} }); send({ id: 2, method: 'account/rateLimits/read' });
      } else if (msg.id === 2) {
        if (msg.error || !msg.result || typeof msg.result !== 'object') return done(new Error('rate_limits_unavailable'));
        const rate = msg.result.rateLimits;
        if (!rate || typeof rate !== 'object') return done(new Error('rate_limits_unavailable'));
        const bucket = value => value && typeof value === 'object' ? { usedPercent: value.usedPercent ?? null, windowDurationMins: value.windowDurationMins ?? null, resetsAt: value.resetsAt ?? null } : null;
        done(null, { primary: bucket(rate.primary), secondary: bucket(rate.secondary), rateLimitReachedType: rate.rateLimitReachedType ?? null });
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ais_cloud_preflight', version: '1.0' } } });
  });
}

export async function diagnose({ list, limits }) {
  const [cloud, quota] = await Promise.allSettled([list(), limits()]);
  return {
    cloud: cloud.status === 'fulfilled' ? { state: 'read', tasks: cloud.value } : { state: 'unavailable' },
    limits: quota.status === 'fulfilled' ? { state: 'read', value: quota.value } : { state: 'unavailable' },
    // The task list alone cannot correlate older work, confirm delivery or authorize dispatch.
    dispatch_authorized: false,
  };
}

async function main() {
  const result = await diagnose({
    list: () => readTaskPages(async args => (await exec('codex', args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout),
    limits: readLimits,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.cloud.state !== 'read' || result.limits.state !== 'read') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('cloud_preflight_failed'); process.exitCode = 1; });
