import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
// @ts-expect-error Packaging scripts run directly in Node.
import { promotePreview } from '../scripts/promote-preview.mjs';

let root: string;
const relative = 'release-test-review';
const payload = `${relative}/win-unpacked`;
let evidence: any;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-preview-'));
  await fs.mkdir(path.join(root, payload, 'resources/extension'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile('scripts/start-ui-preview.ps1', path.join(root, 'scripts/start-ui-preview.ps1'));
  await fs.writeFile(path.join(root, payload, 'Chat On Steroids.exe'), 'fixture-executable');
  await fs.writeFile(path.join(root, payload, 'resources/app.asar'), 'fixture-asar');
  await fs.writeFile(path.join(root, payload, 'resources/extension/manifest.json'), '{"version":"2.0.9"}');
  await fs.writeFile(path.join(root, payload, 'resources/extension/background.js'), 'const BRIDGE_PROTOCOL = 14;');
  evidence = { status: 'PASS_SCOPED', automated: { exitCode: 0 }, build: { status: 'PASS', runtimeSmoke: 'PASS' },
    live: { status: 'PASS_SCOPED' }, sourceDrift: 0, version: '2.0.9-accounts-preview.8', dataDirectory: 'Chat On Steroids UI Preview',
    executable: 'win-unpacked/Chat On Steroids.exe', previewAsarSha256: createHash('sha256').update('fixture-asar').digest('hex') };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function promote() {
  await fs.writeFile(path.join(root, relative, 'build-evidence.json'), JSON.stringify(evidence));
  return promotePreview(root, `${relative}/build-evidence.json`);
}
it('publishes one package including extension/native payloads and preserves previous selection on failed acceptance', async () => {
  const manifest = await promote();
  expect(manifest.files).toHaveLength(4);
  expect(manifest.protocolVersion).toBe(14);
  const before = await fs.readFile(path.join(root, 'preview-build.json'), 'utf8');
  evidence.automated.exitCode = 1;
  await expect(promote()).rejects.toThrow('acceptance');
  expect(await fs.readFile(path.join(root, 'preview-build.json'), 'utf8')).toBe(before);
});
it('refuses changed packages and evidence outside the workspace', async () => {
  await fs.writeFile(path.join(root, payload, 'resources/app.asar'), 'changed');
  await expect(promote()).rejects.toThrow('changed');
  await expect(promotePreview(root, '../outside.json')).rejects.toThrow('path');
});
it.runIf(process.platform === 'win32')('launcher validates without starting a process and rejects extension tampering', async () => {
  await promote();
  const run = () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/start-ui-preview.ps1'), '-ValidateOnly'], { encoding: 'utf8', windowsHide: true });
  const first = run();
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toContain('Verified preview');
  await fs.writeFile(path.join(root, payload, 'resources/extension/background.js'), 'changed');
  expect(run().status).not.toBe(0);
});
