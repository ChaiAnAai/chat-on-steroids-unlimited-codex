import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function promotePreview(root, evidenceFile) {
  const absoluteRoot = await fs.realpath(root);
  async function inside(relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid preview path');
    const file = path.resolve(absoluteRoot, relative);
    if (!file.startsWith(absoluteRoot + path.sep)) throw new Error('Preview path leaves workspace');
    const actual = await fs.realpath(file);
    if (actual.toLowerCase() !== file.toLowerCase()) throw new Error('Preview paths may not contain links');
    return file;
  }
  const evidencePath = await inside(evidenceFile);
  const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  if (evidence.status !== 'PASS_SCOPED' || evidence.automated?.exitCode !== 0 ||
      evidence.build?.status !== 'PASS' || evidence.build?.runtimeSmoke !== 'PASS' ||
      evidence.live?.status !== 'PASS_SCOPED' || evidence.sourceDrift !== 0 ||
      evidence.dataDirectory !== 'Chat On Steroids UI Preview' ||
      !/^\d+\.\d+\.\d+-accounts-preview\.\d+$/.test(evidence.version)) throw new Error('Preview acceptance gates have not passed');
  const packageDir = path.relative(absoluteRoot, path.dirname(evidencePath)).replaceAll('\\', '/');
  if (!/^release-[^/]+$/.test(packageDir) || evidence.executable !== 'win-unpacked/Chat On Steroids.exe') throw new Error('Invalid preview package');
  const executable = `${packageDir}/${evidence.executable}`;
  const files = [];
  // Include every packaged payload, not only app.asar: extension and native binaries matter too.
  async function collect(relative) {
    for (const entry of await fs.readdir(await inside(relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Preview paths may not contain links');
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files.push({ path: name, sha256: createHash('sha256').update(await fs.readFile(await inside(name))).digest('hex') });
      else throw new Error('Unsupported preview payload');
    }
  }
  await collect(`${packageDir}/win-unpacked`);
  const asar = files.find(file => file.path === `${packageDir}/win-unpacked/resources/app.asar`);
  if (!asar || asar.sha256.toLowerCase() !== evidence.previewAsarSha256?.toLowerCase()) throw new Error('Packaged app changed after verification');
  const extension = JSON.parse(await fs.readFile(await inside(`${packageDir}/win-unpacked/resources/extension/manifest.json`), 'utf8'));
  const background = await fs.readFile(await inside(`${packageDir}/win-unpacked/resources/extension/background.js`), 'utf8');
  const protocol = Number(background.match(/const BRIDGE_PROTOCOL = (\d+);/)?.[1]);
  if (!Number.isSafeInteger(protocol) || protocol < 14) throw new Error('Unsupported preview extension protocol');
  const manifest = { schemaVersion: 1, status: 'PASS_SCOPED', version: evidence.version,
    extensionVersion: extension.version, protocolVersion: protocol, dataDirectory: evidence.dataDirectory,
    executable, evidence: evidenceFile.replaceAll('\\', '/'), verifiedAt: evidence.verifiedAt,
    files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  const temp = path.join(absoluteRoot, `.preview-build-${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n');
  try { await fs.rename(temp, path.join(absoluteRoot, 'preview-build.json')); }
  catch (error) { await fs.rm(temp, { force: true }); throw error; }
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  promotePreview(workspace, process.argv[2]).then(result => console.log(`Selected ${result.version}: ${result.files.length} payloads`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
