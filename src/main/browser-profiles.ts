import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Account, ExistingBrowserProfile } from '../shared/accounts.js';

// Only standard Windows installations are discovered. An IPC caller cannot supply a
// filesystem path. Read names from Local State, never Cookies, Login Data or tokens.
export const EXISTING_PROFILE_DIRECTORY = /^(?:Default|Profile [1-9][0-9]{0,5})$/;
export function browserUserDataRoot(browser: Account['browser'], localAppData = process.env.LOCALAPPDATA, platform = process.platform): string | null {
  if (platform !== 'win32' || !localAppData || !path.isAbsolute(localAppData)) return null;
  return path.join(localAppData, ...(browser === 'chrome' ? ['Google', 'Chrome', 'User Data'] : ['Microsoft', 'Edge', 'User Data']));
}
export async function listExistingBrowserProfiles(localAppData = process.env.LOCALAPPDATA, platform = process.platform): Promise<ExistingBrowserProfile[]> {
  const result: ExistingBrowserProfile[] = [];
  for (const browser of ['chrome', 'edge'] as const) {
    const root = browserUserDataRoot(browser, localAppData, platform);
    if (!root) continue;
    try {
      const file = await fs.open(path.join(root, 'Local State'), 'r');
      let raw: string;
      try {
        const size = (await file.stat()).size;
        if (size > 8 * 1024 * 1024) continue;
        const buffer = Buffer.alloc(size + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > size) continue;
        raw = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await file.close(); }
      const cache: unknown = JSON.parse(raw).profile?.info_cache;
      if (!cache || typeof cache !== 'object' || Array.isArray(cache)) continue;
      for (const [directory, value] of Object.entries(cache).slice(0, 100)) {
        if (!EXISTING_PROFILE_DIRECTORY.test(directory) || !value || typeof value !== 'object') continue;
        const stat = await fs.lstat(path.join(root, directory)).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) continue;
        const name = 'name' in value && typeof value.name === 'string' ? value.name.slice(0, 160) : directory;
        result.push({ browser, directory, displayName: name || directory });
      }
    } catch { /* Missing, locked or invalid metadata is not proof of an available profile. */ }
  }
  return result;
}
/** Recheck the selected profile at launch; never fall back to Default or create a missing one. */
export async function existingAccountBrowserTarget(account: Account): Promise<{ profileDirectory: string; profileName: string }> {
  const directory = account.existingProfileDirectory;
  const profiles = await listExistingBrowserProfiles();
  const root = browserUserDataRoot(account.browser);
  if (!root || !directory || !profiles.some(row => row.browser === account.browser && row.directory === directory)) throw new Error('Existing browser profile is unavailable');
  return { profileDirectory: root, profileName: directory };
}
