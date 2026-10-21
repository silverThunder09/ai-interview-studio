/** Failure-only diagnostics: API names/status, never selectors, arguments, page text or keys. */
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
const METHODS = new Set(['launch', 'close', 'firstWindow', 'evaluate', 'click', 'fill', 'press', 'selectOption', 'screenshot', 'getAttribute', 'inputValue', 'waitForEvent', 'isVisible', 'isChecked', 'toBeVisible', 'toBeFocused', 'toHaveCount', 'toHaveValue', 'toHaveAttribute', 'toBeChecked']);
const methodName = value => METHODS.has(value) ? value : 'unknown';
const apiName = value => typeof value === 'string' && /^(electron|electronApplication|page|locator|browser|browserContext|frame|expect)\.[A-Za-z]{1,40}$/.test(value) && METHODS.has(value.slice(value.lastIndexOf('.') + 1)) ? value : 'unknown';
export function summarizeTrace(text) {
  if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) throw new Error('trace_size');
  const calls = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let item; try { item = JSON.parse(line); } catch { continue; }
    if (!item || typeof item !== 'object' || typeof item.callId !== 'string') continue;
    if (item.type === 'before') calls.set(item.callId, { api: apiName(item.apiName), method: methodName(item.method), finished: false, error: false });
    if (item.type === 'after' && calls.has(item.callId)) { const c = calls.get(item.callId); c.finished = true; c.error = Boolean(item.error); }
    if (calls.size > 10000) throw new Error('trace_call_limit');
  }
  return [...calls.values()].slice(-10);
}
async function main() {
  let unzipSync; try { ({ unzipSync } = await import('fflate')); } catch { console.log('Smoke trace dependency unavailable.'); return; }
  let entries; try { entries = await readdir('test-results', { withFileTypes: true }); } catch { console.log('No smoke traces present.'); return; }
  for (const entry of entries.slice(0,20)) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,200}$/.test(entry.name)) continue;
    const path = join('test-results', entry.name, 'trace.zip');
    try {
      const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) continue;
      const files = unzipSync(await readFile(path), { filter: f => /^[A-Za-z0-9_-]+\.trace$/.test(f.name) && f.originalSize <= 20 * 1024 * 1024 });
      for (const bytes of Object.values(files)) console.log(JSON.stringify({ test: entry.name, calls: summarizeTrace(new TextDecoder().decode(bytes)) }));
    } catch { console.log('Smoke trace summary unavailable; original test failure is unchanged.'); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
