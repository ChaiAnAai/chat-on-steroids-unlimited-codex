import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

/** Export only the installed companion, never a guessed release URL or browser profile. */
export async function extensionArchive(root: string, license: Uint8Array): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = Object.create(null);
  let size = 0;
  let count = 0;
  async function visit(relative = ''): Promise<void> {
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('The bundled extension contains an unsupported link.');
    if (info.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) {
        if (name === '.chat-on-steroids-source') continue;
        await visit(relative ? `${relative}/${name}` : name);
      }
      return;
    }
    if (!info.isFile() || ++count > 500 || (size += info.size) > 16 * 1024 * 1024) {
      throw new Error('The bundled extension exceeds the export limits.');
    }
    files[relative] = await readFile(absolute);
  }
  await visit();
  if (!files['manifest.json'] || !files['background.js']) throw new Error('The bundled extension is incomplete.');
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  if (manifest.manifest_version !== 3 || typeof manifest.version !== 'string') throw new Error('The bundled extension manifest is invalid.');
  files.LICENSE = license;
  return zipSync(files);
}
