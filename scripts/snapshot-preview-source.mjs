import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dirname, '..');
const output = process.argv[2];
if (!/^release-[a-z0-9-]+$/.test(output ?? '')) throw new Error('Supply a review directory name');
const files = new Map();
async function collect(relative) {
  const file = path.join(root, relative), stat = await fs.lstat(file);
  if (stat.isSymbolicLink()) throw new Error(`Source snapshot refuses links: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(file)) await collect(`${relative}/${name}`);
  } else if (stat.isFile()) files.set(relative, await fs.readFile(file));
}
// Deliberately exclude Git history, user data, release/out directories and dependency binaries.
for (const name of ['src', 'test', 'scripts', 'extension', 'build', 'package.json', 'package-lock.json',
  'electron-builder.yml', 'electron.vite.config.ts', 'tsconfig.json', 'vitest.config.ts', 'AGENTS.md', 'README.md',
  'LICENSE', 'THIRD-PARTY-NOTICES.txt']) await collect(name);
const rows = [...files].map(([name, bytes]) => ({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') }));
await fs.mkdir(path.join(root, output), { recursive: true });
await fs.writeFile(path.join(root, output, 'source-snapshot.json'), JSON.stringify(rows, null, 2) + '\n');
await fs.writeFile(path.join(root, output, 'source-review.zip'), zipSync(Object.fromEntries(files), { level: 6 }));
const extension = Object.fromEntries([...files].filter(([name]) => name.startsWith('extension/')).map(([name, bytes]) => [name.slice(10), bytes]));
await fs.writeFile(path.join(root, output, 'extension-protocol-14.zip'), zipSync(extension, { level: 6 }));
console.log(`Saved ${rows.length} source/configuration files and companion extension; dependency binaries are rebuilt separately.`);
