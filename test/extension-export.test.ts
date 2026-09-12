import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { extensionArchive } from '../src/main/extension-export.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let root: string | undefined;
afterEach(async () => { if (root) await removeTempDir(root); root = undefined; });
async function fixture() {
  root = await makeTempDir('companion-export-');
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '2.1.0' }));
  await fs.writeFile(path.join(root, 'background.js'), 'companion');
  return root;
}
it('exports the exact companion and license without its local materialization marker', async () => {
  const dir = await fixture();
  await fs.writeFile(path.join(dir, '.chat-on-steroids-source'), 'local marker');
  const files = unzipSync(await extensionArchive(dir, Buffer.from('MIT license')));
  expect(Object.keys(files).sort()).toEqual(['LICENSE', 'background.js', 'manifest.json']);
  expect(Buffer.from(files.LICENSE!).toString()).toBe('MIT license');
});
it('rejects an incomplete companion rather than offering a broken archive', async () => {
  const dir = await fixture();
  await fs.unlink(path.join(dir, 'background.js'));
  await expect(extensionArchive(dir, Buffer.from('MIT'))).rejects.toThrow('incomplete');
});
it('rejects directory links instead of exporting files outside the companion', async () => {
  const dir = await fixture();
  await fs.symlink(path.dirname(dir), path.join(dir, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  try { await expect(extensionArchive(dir, Buffer.from('MIT'))).rejects.toThrow('unsupported link'); }
  finally { await fs.unlink(path.join(dir, 'outside')); }
});
