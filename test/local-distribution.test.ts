import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { DISTRIBUTION } from '../src/shared/distribution.js';
vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('../src/main/logger.js', () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

it('never fetches or installs an upstream update in the local edition', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try {
    const update = await import('../src/main/update.js');
    expect(update.stagedArtifact('win32', 'x64', undefined, true)).toBeNull();
    update.startUpdateChecks(); await update.checkForUpdates();
    expect(update.markInstallOnQuit()).toBe(false);
    await update.applyStagedUpdate();
    expect(fetcher).not.toHaveBeenCalled();
    expect(update.updateStatus().stage).toBe('idle');
  } finally { vi.unstubAllGlobals(); }
});

it('ships one matching local bridge range in the desktop app and companion', () => {
  const source = readFileSync('extension/background.js', 'utf8');
  const ports = JSON.parse(source.match(/const PORTS = (\[[^;]+\]);/)![1]!);
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  expect(ports).toEqual(DISTRIBUTION.bridgePorts);
  expect(ports).not.toContain(8765);
  for (const port of ports) expect(manifest.host_permissions).toContain(`http://127.0.0.1:${port}/*`);
});
