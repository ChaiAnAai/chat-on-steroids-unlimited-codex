import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { browserUserDataRoot, listExistingBrowserProfiles, existingAccountBrowserTarget } from '../src/main/browser-profiles.js';
import type { Account } from '../src/shared/accounts.js';
let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-profile-metadata-')); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });
async function metadata() {
  const root = browserUserDataRoot('chrome', dir, 'win32')!;
  await fs.mkdir(path.join(root, 'Profile 2'), { recursive: true });
  await fs.writeFile(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: {
    'Profile 2': { name: 'Existing work', user_name: 'private email', token: 'private token' },
    '../outside': { name: 'Traversal' }, 'Profile 9': { name: 'Deleted' }, 'Guest Profile': { name: 'Guest' }
  } } }));
  return root;
}
it('lists only available standard profiles, projecting names without credentials or identity claims', async () => {
  const root = await metadata(); const opened = vi.spyOn(fs, 'open');
  expect(await listExistingBrowserProfiles(dir, 'win32')).toEqual([{ browser: 'chrome', directory: 'Profile 2', displayName: 'Existing work' }]);
  expect(opened.mock.calls.every(call => String(call[0]).endsWith('Local State'))).toBe(true);
  expect(await fs.readFile(path.join(root, 'Local State'), 'utf8')).toContain('private token');
  expect(await listExistingBrowserProfiles(dir, 'linux')).toEqual([]);
});
it('does not present missing or malformed Local State as a usable default profile', async () => {
  const root = await metadata(); await fs.writeFile(path.join(root, 'Local State'), '{');
  expect(await listExistingBrowserProfiles(dir, 'win32')).toEqual([]);
});
it.skipIf(process.platform !== 'win32')('rechecks a bound profile at launch and refuses deleted profiles without creating a replacement', async () => {
  const root = await metadata(); vi.stubEnv('LOCALAPPDATA', dir);
  const account = { browser: 'chrome', existingProfileDirectory: 'Profile 2' } as Account;
  expect(await existingAccountBrowserTarget(account)).toEqual({ profileDirectory: root, profileName: 'Profile 2' });
  await fs.rmdir(path.join(root, 'Profile 2'));
  await expect(existingAccountBrowserTarget(account)).rejects.toThrow('unavailable');
  await expect(fs.stat(path.join(root, 'Default'))).rejects.toThrow();
});
