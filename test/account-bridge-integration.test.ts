import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('electron', () => ({ safeStorage: {
  isAsyncEncryptionAvailable: vi.fn(async () => true), getSelectedStorageBackend: () => 'unknown',
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }))
}, clipboard: {}, shell: {} }));
import { initConfigPath, saveConfig, defaultConfig } from '../src/main/config.js';
import { initSecretsPath, resetSecretsCacheForTests } from '../src/main/secrets.js';
import { initDurableStore, resetDurableForTests, flushDurable } from '../src/main/durable.js';
import { initSessionStore, resetSessionStoreForTests } from '../src/main/session/store.js';
import { startBridge, stopBridge, configuredBridgePorts, DEFAULT_PORTS } from '../src/main/bridge.js';
import { prepareAccountSetup, accountSetupView, createAccount, confirmPendingAccountPairing, listPendingAccountPairings, getAccount, disconnectAccount, reconnectAccount, resetAccountsForTests } from '../src/main/accounts.js';
import { BRIDGE_PROTOCOL } from '../src/main/version.js';
let dir: string, base: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-account-http-'));
  initConfigPath(dir); initSecretsPath(dir); initDurableStore(dir); initSessionStore(dir); resetAccountsForTests();
  await saveConfig(defaultConfig()); const port = await startBridge(); expect(port).not.toBeNull(); base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await stopBridge(); await flushDurable(); resetSessionStoreForTests(); resetAccountsForTests(); resetSecretsCacheForTests(); resetDurableForTests();
  await fs.rm(dir, { recursive: true, force: true });
});
async function post(body: unknown, token?: string, protocol = BRIDGE_PROTOCOL) {
  const response = await fetch(`${base}/accounts/pair`, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-extension-protocol': String(protocol), 'x-extension-version': '2.0.9',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
it('reads the entrypoint port policy at startup rather than freezing it during static imports', () => {
  const before = process.env.CLF_BRIDGE_PORTS;
  try {
    delete process.env.CLF_BRIDGE_PORTS;
    expect(configuredBridgePorts()).toEqual(DEFAULT_PORTS);
    process.env.CLF_BRIDGE_PORTS = '0';
    expect(configuredBridgePorts()).toEqual([0]);
    process.env.CLF_BRIDGE_PORTS = '50123';
    expect(configuredBridgePorts()).toEqual([50123]);
  } finally { if (before === undefined) delete process.env.CLF_BRIDGE_PORTS; else process.env.CLF_BRIDGE_PORTS = before; }
});
it('requires real main confirmation, mints once, and keeps popup configuration separate from credentials', async () => {
  const account = await createAccount({ displayName: 'A', browser: 'chrome', profileRef: 'test-profile-a' });
  const configuration = { accountId: account.id, browser: account.browser, profileRef: account.profileRef };
  expect((await post(configuration, undefined, BRIDGE_PROTOCOL - 1)).status).toBe(426);
  const requested = await post(configuration); expect(requested.status).toBe(202);
  const claim = { accountId: account.id, nonce: requested.body.nonce };
  expect((await post(claim)).status).toBe(409);
  const pending = (await listPendingAccountPairings())[0]!;
  expect(JSON.stringify(pending)).not.toContain(requested.body.nonce);
  await confirmPendingAccountPairing(account.id, pending.requestId);
  const paired = await post(claim); expect(paired.status).toBe(200); expect(paired.body.bridgeToken).toHaveLength(64);
  expect((await post(claim)).status).toBe(409);
  expect(await getAccount(account.id)).toMatchObject({ paused: true, identity: null });
});
it('rechecks only an authenticated saved binding after explicit main reconnect; another account token cannot select it', async () => {
  const credentials: Array<{ accountId: string; bridgeToken: string; connectionVersion: number }> = [];
  for (const label of ['B', 'C']) {
    const account = await createAccount({ displayName: label, browser: 'edge', profileRef: `test-profile-${label}` });
    const request = await post({ accountId: account.id, browser: account.browser, profileRef: account.profileRef });
    const pending = (await listPendingAccountPairings()).find(row => row.accountId === account.id)!;
    await confirmPendingAccountPairing(account.id, pending.requestId);
    credentials.push((await post({ accountId: account.id, nonce: request.body.nonce })).body);
  }
  const [a, b] = credentials as [typeof credentials[number], typeof credentials[number]];
  const recheck = { action: 'recheck', accountId: a.accountId };
  expect((await post(recheck, b.bridgeToken)).status).toBe(401);
  await disconnectAccount(a.accountId);
  expect((await post(recheck, a.bridgeToken)).status).toBe(401);
  await reconnectAccount(a.accountId);
  const latest = await post(recheck, a.bridgeToken);
  expect(latest.status).toBe(200);
  expect(latest.body).toEqual({ accountId: a.accountId, connectionVersion: a.connectionVersion + 2, identityVerified: false });
  expect(await getAccount(a.accountId)).toMatchObject({ paused: true, identity: null });
});

it('exposes only an explicit expiring invitation and gates progress by the request nonce', async () => {
  const account = await createAccount({ displayName: 'Invitation', browser: 'chrome', profileRef: 'test-invitation' });
  const headers = { 'x-extension-protocol': String(BRIDGE_PROTOCOL), 'x-extension-version': '2.1.1' };
  expect(await (await fetch(`${base}/accounts/setup`, { headers })).json()).toMatchObject({ setup: null });
  const setup = await prepareAccountSetup(account.id);
  const view = await (await fetch(`${base}/accounts/setup`, { headers })).json();
  expect(view.setup.displayName).toBe('Invitation'); expect(JSON.stringify(view)).not.toMatch(/nonce|bridgeToken|identity/);
  expect((await fetch(`${base}/accounts/setup`, { headers: { ...headers, origin: 'https://evil.example' } })).status).toBe(403);
  expect((await fetch(`${base}/accounts/setup`, { headers: { ...headers, 'x-extension-protocol': '13' } })).status).toBe(426);
  const config = { accountId: account.id, browser: account.browser, profileRef: account.profileRef };
  expect((await post({ ...config, setupId: 'wrong' })).status).toBe(409);
  const requested = await post({ ...config, setupId: setup!.setupId }); expect(requested.status).toBe(202);
  expect((await post({ action: 'status', accountId: account.id, nonce: '0'.repeat(64) })).status).toBe(409);
  const progress = { action: 'status', accountId: account.id, nonce: requested.body.nonce };
  expect((await post(progress)).body).toMatchObject({ confirmed: false });
  await confirmPendingAccountPairing(account.id, requested.body.requestId);
  expect((await post(progress)).body).toMatchObject({ confirmed: true });
  expect(JSON.stringify((await post(progress)).body)).not.toMatch(/nonce|bridgeToken/);
  await disconnectAccount(account.id);
  expect((await post(progress)).status).toBe(409); expect(await accountSetupView()).toBeNull();
});
