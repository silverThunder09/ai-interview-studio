import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
// These scripts provision Linux Cloud only; Windows app verification remains separate.
describe.skipIf(process.platform !== 'linux')('versioned Linux Cloud runtime', () => {
  function fixture(root = false) {
    const directory = mkdtempSync(join(tmpdir(), 'ais-runtime-test-')); temporary.push(directory);
    const repo = join(directory, 'repo'), bin = join(directory, 'bin'), cache = join(directory, 'cache'), calls = join(directory, 'calls');
    const put = (path: string, content: string, executable = false) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, content, { mode: executable ? 0o755 : 0o644 }); };
    mkdirSync(cache, { recursive: true });
    for (const name of ['setup.sh', 'smoke.sh']) put(join(repo, 'scripts/codex', name), readFileSync(`scripts/codex/${name}`, 'utf8'));
    put(join(repo, '.node-version'), process.versions.node + '\n');
    put(join(repo, 'src/value.txt'), 'uncommitted work'); put(join(repo, 'out/main/index.js'), 'built work');
    put(join(repo, 'private.env'), 'synthetic untracked file must not be copied');
    put(join(repo, 'node_modules/@playwright/test/cli.js'), `
const fs=require('node:fs'),assert=require('node:assert');
assert.notEqual(process.getuid(),0);
assert.deepEqual(process.argv.slice(2),['test','tests/smoke/gemini.spec.ts','tests/smoke/avatar.spec.ts','tests/smoke/desktop.spec.ts']);
assert.equal(process.env.STUDIO_SMOKE_HEADLESS,'1');
assert.equal(fs.readFileSync('src/value.txt','utf8'),'uncommitted work');
assert.equal(fs.readFileSync('out/main/index.js','utf8'),'built work');
if(process.env.AIS_TEST_ROOT==='1')assert.equal(fs.existsSync('private.env'),false);
fs.appendFileSync(process.env.AIS_TEST_CALLS,'smoke\\n');
process.exit(Number(process.env.AIS_TEST_SMOKE_EXIT||0));`);
    put(join(repo, 'node_modules/electron/install.js'), '/* synthetic installer, no network */');
    put(join(repo, 'node_modules/electron/dist/electron'), 'synthetic binary');
    put(join(repo, 'node_modules/.bin/playwright'), '#!/bin/bash\nprintf "os-deps %s\\n" "$*" >> "$AIS_TEST_CALLS"\n', true);
    const command = (name: string, body: string) => put(join(bin, name), '#!/bin/bash\nset -eu\n' + body + '\n', true);
    command('git', 'case "$*" in\n "rev-parse HEAD") printf "%040d\\n" 1;;\n "ls-files -z") printf "%s\\0" .node-version src/value.txt;;\n "diff --exit-code -- package.json package-lock.json .node-version") exit 0;;\n *) exit 2;;\nesac');
    command('id', 'if [ "$#" -eq 2 ] && [ "$2" = "ais-test" ]; then echo 1000; elif [ "${AIS_TEST_ROOT:-0}" = 1 ] && [ "${AIS_TEST_RUNTIME:-0}" != 1 ]; then echo 0; else echo 1000; fi');
    command('getent', 'if [ "${AIS_TEST_NO_USER:-0}" = 1 ]; then exit 2; fi\nprintf "ais-test:x:1000:1000::/tmp:/bin/bash\\n"');
    // Simulates privilege-drop dispatch while the test itself already runs as UID 1000.
    command('runuser', '[ "$1" = -u ] && [ "$2" = ais-test ] && [ "$3" = -- ]\nshift 3\nAIS_TEST_RUNTIME=1 "$@"');
    command('npm', 'printf "npm %s\\n" "$*" >> "$AIS_TEST_CALLS"\nif [ "$*" = "run check" ]; then exit "${AIS_TEST_CHECK_EXIT:-0}"; fi');
    command('ldd', 'if [ "${AIS_TEST_MISSING_LIB:-0}" = 1 ]; then echo "libfixture.so => not found"; else echo "libraries available"; fi');
    const run = (name = 'smoke.sh', args: string[] = [], extra: Record<string, string> = {}) => spawnSync('bash', [join(repo, 'scripts/codex', name), ...args], { cwd: repo, encoding: 'utf8', timeout: 20000, env: { ...process.env, PATH: bin + ':' + process.env.PATH, TMPDIR: cache, AIS_TEST_CALLS: calls, AIS_TEST_ROOT: root ? '1' : '0', SMOKE_EXECUTABLE: '', BASH_ENV: '', ...extra } });
    const log = () => { try { return readFileSync(calls, 'utf8').trim().split('\n'); } catch { return []; } };
    const evidence = (prefix: string) => join(cache, readdirSync(cache).find(n => n.startsWith(prefix))!);
    return { repo, run, log, evidence };
  }
  it('runs the fixed three source tests headlessly as an existing non-root process', () => {
    const f = fixture(), r = f.run(); expect(r.status, r.stderr).toBe(0); expect(f.log()).toEqual(['smoke']);
    expect(readFileSync(join(f.evidence('ais-codex-smoke-evidence.'), 'runtime-uid'), 'utf8').trim()).toBe('1000');
  });
  it('copies current working edits and build output for the root launcher without copying untracked files', () => {
    const f = fixture(true), r = f.run(); expect(r.status, r.stderr).toBe(0); expect(f.log()).toEqual(['smoke']);
    expect(readFileSync(join(f.repo, 'src/value.txt'), 'utf8')).toBe('uncommitted work');
    const e = f.evidence('ais-codex-smoke-evidence.');
    expect(readFileSync(join(e, 'launcher-uid'), 'utf8').trim()).toBe('0');
    expect(readFileSync(join(e, 'runtime-uid'), 'utf8').trim()).toBe('1000');
  });
  it('fails before launch when no existing UID 1000 account is available', () => {
    const f = fixture(true), r = f.run('smoke.sh', [], { AIS_TEST_NO_USER: '1' });
    expect(r.status).toBe(2); expect(r.stderr).toContain('account unavailable'); expect(f.log()).toEqual([]);
  });
  it('preserves a smoke failure exit code in its evidence', () => {
    const f = fixture(), r = f.run('smoke.sh', [], { AIS_TEST_SMOKE_EXIT: '17' }); expect(r.status).toBe(17);
    expect(readFileSync(join(f.evidence('ais-codex-smoke-evidence.'), 'exit-code'), 'utf8').trim()).toBe('17');
  });
  it('refuses a missing build and executable overrides', () => {
    const f = fixture(); rmSync(join(f.repo, 'out'), { recursive: true }); expect(f.run().status).toBe(2);
    expect(f.run('smoke.sh', [], { SMOKE_EXECUTABLE: '/not-used' }).status).toBe(2); expect(f.log()).toEqual([]);
  });
  it('refuses fresh OS provisioning outside the initial root phase', () => {
    const f = fixture(), r = f.run('setup.sh', ['--fresh']); expect(r.status).toBe(2); expect(f.log()).toEqual([]);
  });
  it('reuses dependencies explicitly and runs check/build/smoke without installation', () => {
    const f = fixture(), r = f.run('setup.sh', ['--reuse']); expect(r.status, r.stderr).toBe(0);
    expect(f.log()).toEqual(['npm run check', 'npm run build', 'smoke']);
    expect(readFileSync(join(f.evidence('ais-codex-setup.'), 'install-status'), 'utf8')).toContain('not-run');
  });
  it('installs only in the explicit fresh phase before validation', () => {
    const f = fixture(true), r = f.run('setup.sh', ['--fresh']); expect(r.status, r.stderr).toBe(0);
    expect(f.log()).toEqual(['npm ci --no-audit --no-fund', 'os-deps install-deps chromium firefox', 'npm run check', 'npm run build', 'smoke']);
  });
  it('stops on check failure without building or claiming a smoke result', () => {
    const f = fixture(), r = f.run('setup.sh', ['--reuse'], { AIS_TEST_CHECK_EXIT: '7' }); expect(r.status).toBe(7);
    expect(f.log()).toEqual(['npm run check']);
    expect(readFileSync(join(f.evidence('ais-codex-setup.'), 'check.exit-code'), 'utf8').trim()).toBe('7');
  });
  it('rejects missing libraries even when ldd exits zero', () => {
    const f = fixture(), r = f.run('setup.sh', ['--reuse'], { AIS_TEST_MISSING_LIB: '1' });
    expect(r.status).toBe(1); expect(f.log()).toEqual([]);
  });
});
