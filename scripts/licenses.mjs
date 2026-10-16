import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Collect actual installed runtime dependencies and fail if notice text is missing.
const root = JSON.parse(await readFile('package.json', 'utf8'));
const visited = new Set();
const notices = [];
async function collect(name, parent = process.cwd()) {
  let base = parent;
  let dir;
  for (;;) {
    const candidate = join(base, 'node_modules', name);
    try { await readFile(join(candidate, 'package.json')); dir = candidate; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = dirname(base);
    if (next === base) throw new Error(`Missing installed runtime dependency: ${name}`);
    base = next;
  }
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (visited.has(key)) return;
  visited.add(key);
  const files = (await readdir(dir)).filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file));
  if (!files.length) throw new Error(`Missing license text: ${key}`);
  const texts = await Promise.all(files.sort().map(async (file) => `--- ${file} ---\n${await readFile(join(dir, file), 'utf8')}`));
  notices.push(`${key}\nDeclared license: ${pkg.license ?? 'UNKNOWN'}\n${texts.join('\n')}`);
  for (const child of Object.keys(pkg.dependencies ?? {}).sort()) await collect(child, dir);
}
for (const name of Object.keys(root.dependencies ?? {}).sort()) await collect(name);
await mkdir('release-notices', { recursive: true });
await writeFile('release-notices/THIRD-PARTY-NOTICES.txt', notices.join('\n\n====================\n\n'));
console.log(`Collected full license texts for ${visited.size} installed runtime packages. Electron/Chromium notices are retained by the packager.`);
