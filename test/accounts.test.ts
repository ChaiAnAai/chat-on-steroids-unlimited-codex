import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('electron', () => ({ safeStorage: {
  isAsyncEncryptionAvailable: vi.fn(async () => true), getSelectedStorageBackend: vi.fn(() => 'unknown'),
  encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value)),
  decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }))
} }));
import { initDurableStore, resetDurableForTests, readDurable } from '../src/main/durable.js';
import { initSecretsPath, resetSecretsCacheForTests } from '../src/main/secrets.js';
import { authenticateAccount, assertAccountConnection, claimAccountPairing, confirmAccountPairing, createAccount, disconnectAccount, getAccount, getAccountMcpToken, isAccountPrincipalCurrent, listAccounts, removeAccount, requestAccountPairing, resetAccountsForTests, resolveMcpAccountToken, setAccountIdentity, setAccountPaused } from '../src/main/accounts.js';
import { listPendingAccountPairings, confirmPendingAccountPairing, reconnectAccount } from '../src/main/accounts.js';
import { accountProfilePath, createAccountManagement } from '../src/main/account-management.js';
import { observeAccountUsage, accountQuotaView, automationQuota } from '../src/main/session/usage.js';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-accounts-')); initDurableStore(dir); initSecretsPath(dir); resetSecretsCacheForTests(); resetAccountsForTests(); });
afterEach(async () => { resetAccountsForTests(); resetSecretsCacheForTests(); resetDurableForTests(); vi.restoreAllMocks(); await fs.rm(dir, { force: true, recursive: true }); });
async function create(profileRef = 'profile-one', browser: 'chrome' | 'edge' = 'chrome') { return createAccount({ displayName: profileRef, browser, profileRef }); }
async function pair(id: string) {
  const row = (await getAccount(id))!;
  const { nonce } = await requestAccountPairing(id, row);
  await confirmAccountPairing(id, nonce);
  const claim = await claimAccountPairing(id, nonce);
  return { claim, principal: (await authenticateAccount(id, claim.bridgeToken))! };
}
async function active(profileRef = 'one') {
  const row = await create(profileRef); const { claim, principal } = await pair(row.id);
  await setAccountIdentity(principal, { providerId: profileRef, workspaceId: 'personal', displayLabel: 'Observed identity' });
  await setAccountPaused(row.id, false);
  return { row, claim, principal: (await authenticateAccount(row.id, claim.bridgeToken))! };
}
it('isolates bridge and all MCP credentials across accounts without leaking credentials in durable metadata', async () => {
  const one = await active('one'), two = await active('two');
  await expect(authenticateAccount(two.row.id, one.claim.bridgeToken)).resolves.toBeNull();
  await expect(assertAccountConnection(one.principal)).resolves.toBeUndefined();
  const core = (await getAccountMcpToken(one.row.id, 'core'))!;
  expect(core).not.toBe(one.claim.bridgeToken);
  expect(await getAccountMcpToken(two.row.id, 'core')).not.toBe(core);
  expect(await getAccountMcpToken(one.row.id, 'desktop')).not.toBe(core);
  expect(await getAccountMcpToken(one.row.id, 'plugins')).not.toBe(core);
  expect(await resolveMcpAccountToken('core', core)).toMatchObject({ accountId: one.row.id });
  expect(await resolveMcpAccountToken('desktop', core)).toBeNull();
  const metadata = JSON.stringify(await readDurable('accounts'));
  expect(metadata).not.toContain(core); expect(metadata).not.toContain(one.claim.bridgeToken);
});
it('persists account quota separately, rejects stale publication and shows history as unknown after restart', async () => {
  const one = await active('quota-one'), two = await active('quota-two');
  const rows = [{ model: 'shared', scope: 'shared', remaining: null, remainingPercent: 45, resetAt: null, windowSeconds: 3600 }];
  await observeAccountUsage(rows, Date.now(), one.principal);
  expect(await accountQuotaView((await getAccount(one.row.id))!)).toMatchObject({ state: 'fresh', rows: [{ remainingPercent: 45 }] });
  expect(await accountQuotaView((await getAccount(two.row.id))!)).toMatchObject({ state: 'unknown', rows: [] });
  await disconnectAccount(one.row.id);
  await expect(observeAccountUsage(rows, Date.now(), one.principal)).rejects.toThrow('no longer current');
  resetAccountsForTests();
  const restored = (await getAccount(one.row.id))!;
  expect(await accountQuotaView(restored)).toMatchObject({ state: 'stale', rows: [] });
  expect(automationQuota(undefined, 10, restored.id, restored.connectionVersion)).toBe('quota-unknown');
});
it('keeps a newer same-account quota observation when an older callback arrives', async () => {
  const one = await active('quota-order'); const now = Date.now();
  const row = { model: 'shared', scope: 'shared', remaining: null, remainingPercent: 5, resetAt: null, windowSeconds: 3600 };
  await observeAccountUsage([row], now, one.principal);
  await observeAccountUsage([{ ...row, remainingPercent: 90 }], now - 100, one.principal);
  expect(await accountQuotaView((await getAccount(one.row.id))!)).toMatchObject({ state: 'fresh', rows: [{ remainingPercent: 5 }] });
});
it('requires confirmation and single-use nonce; an unsolicited pairing does not revoke a connection', async () => {
  const { row, principal } = await active();
  const pending = await requestAccountPairing(row.id, row);
  expect(await isAccountPrincipalCurrent(principal)).toBe(true);
  await expect(claimAccountPairing(row.id, pending.nonce)).rejects.toThrow('confirmation');
  await expect(requestAccountPairing(row.id, row)).rejects.toThrow('already pending');
  await expect(confirmAccountPairing(row.id, 'wrong')).rejects.toThrow('expired or superseded');
  expect(await isAccountPrincipalCurrent(principal)).toBe(true);
  await confirmAccountPairing(row.id, pending.nonce);
  expect(await isAccountPrincipalCurrent(principal)).toBe(false);
  await claimAccountPairing(row.id, pending.nonce);
  await expect(claimAccountPairing(row.id, pending.nonce)).rejects.toThrow('expired or superseded');
});
it('rejects unknown identity for task authorization while allowing authenticated observations', async () => {
  const row = await create(), { principal } = await pair(row.id);
  await expect(assertAccountConnection(principal)).rejects.toThrow('no longer current');
  await expect(setAccountPaused(row.id, false)).rejects.toThrow('identity');
  await setAccountIdentity(principal, { providerId: 'provider', workspaceId: 'personal', displayLabel: 'Observed' });
  await expect(assertAccountConnection(principal)).rejects.toThrow('no longer current');
});
it('serializes account creation, enforces five maximum and rejects reused profiles', async () => {
  const rows = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`profile-${i}`)));
  expect(new Set(rows.map(row => row.id)).size).toBe(5);
  expect(await listAccounts()).toHaveLength(5);
  await expect(create('six')).rejects.toThrow('five');
  await removeAccount(rows[0]!.id);
  await expect(create('profile-1')).rejects.toThrow('already belongs');
});
it('prevents duplicate provider identity under concurrent identity observations', async () => {
  const one = await create('one'), two = await create('two');
  const a = await pair(one.id), b = await pair(two.id);
  const identity = { providerId: 'same-provider', workspaceId: 'same-workspace', displayLabel: 'Account' };
  const results = await Promise.allSettled([setAccountIdentity(a.principal, identity), setAccountIdentity(b.principal, { ...identity, workspaceId: 'different-workspace' })]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await listAccounts()).filter(row => row.identity)).toHaveLength(1);
  expect((await listAccounts()).filter(row => row.connected)).toHaveLength(1);
});
it('pause, identity change, disconnect and remove revoke old principals and pending pairing', async () => {
  const { row, principal, claim } = await active();
  await setAccountPaused(row.id, true);
  await expect(assertAccountConnection(principal)).rejects.toThrow();
  await setAccountPaused(row.id, false);
  await expect(assertAccountConnection(principal)).rejects.toThrow();
  const current = (await authenticateAccount(row.id, claim.bridgeToken))!;
  await setAccountIdentity(current, { providerId: 'different', workspaceId: 'personal', displayLabel: 'Changed' });
  expect(await isAccountPrincipalCurrent(current)).toBe(false);
  expect((await getAccount(row.id))!.paused).toBe(true);
  const pending = await requestAccountPairing(row.id, row);
  await disconnectAccount(row.id);
  await expect(confirmAccountPairing(row.id, pending.nonce)).rejects.toThrow();
  expect(await authenticateAccount(row.id, claim.bridgeToken)).toBeNull();
  await removeAccount(row.id); expect(await getAccount(row.id)).toBeNull();
});
it('cold restart preserves account/profile/identity but revokes credentials and pending pairing authorization', async () => {
  const { row, principal, claim } = await active();
  const pending = await requestAccountPairing(row.id, row);
  resetAccountsForTests(); resetSecretsCacheForTests();
  const restarted = (await getAccount(row.id))!;
  expect(restarted).toMatchObject({ id: row.id, profileRef: row.profileRef, connected: false, paused: true, identity: { providerId: 'one' } });
  expect(restarted.connectionVersion).toBeGreaterThan(principal.connectionVersion);
  expect(await authenticateAccount(row.id, claim.bridgeToken)).toBeNull();
  await expect(confirmAccountPairing(row.id, pending.nonce)).rejects.toThrow();
  await expect(setAccountPaused(row.id, false)).rejects.toThrow();
});
it('expires a nonce and rejects a nonce requested for another browser profile or account', async () => {
  const row = await create(), other = await create('other', 'edge');
  await expect(requestAccountPairing(row.id, other)).rejects.toThrow('profile');
  const pending = await requestAccountPairing(row.id, row);
  await expect(confirmAccountPairing(other.id, pending.nonce)).rejects.toThrow();
  vi.spyOn(Date, 'now').mockReturnValue(pending.expiresAt);
  await expect(confirmAccountPairing(row.id, pending.nonce)).rejects.toThrow();
});
it('safe pending request IDs cannot redeem tokens and cannot confirm a replacement request', async () => {
  const row = await create(); const request = await requestAccountPairing(row.id, row);
  const summary = (await listPendingAccountPairings())[0]!;
  expect(JSON.stringify(summary)).not.toContain(request.nonce);
  await expect(claimAccountPairing(row.id, summary.requestId)).rejects.toThrow();
  await disconnectAccount(row.id); await requestAccountPairing(row.id, row);
  await expect(confirmPendingAccountPairing(row.id, summary.requestId)).rejects.toThrow('changed');
  const current = (await listPendingAccountPairings())[0]!;
  await confirmPendingAccountPairing(row.id, current.requestId);
  expect(await listPendingAccountPairings()).toEqual([]);
});
it('management allocates safe profiles, exposes no activation action, and preserves data on removal', async () => {
  const openProfile = vi.fn(async () => undefined); const manage = createAccountManagement({ userDataPath: dir, openProfile });
  const created = await manage({ action: 'create', displayName: 'Local only', browser: 'edge' });
  if (!created.ok) throw new Error(created.error);
  const row = created.data.accounts[0]!;
  expect(row.identity).toBeNull(); expect(created.data.executionEnabled).toBe(false);
  const profile = accountProfilePath(dir, row.profileRef); await fs.mkdir(profile, { recursive: true }); await fs.writeFile(path.join(profile, 'history'), 'retained');
  expect((await manage({ action: 'open', accountId: row.id })).ok).toBe(true);
  expect(openProfile).toHaveBeenCalledWith(row, profile);
  expect((await getAccount(row.id))!.connected).toBe(false);
  expect(() => accountProfilePath(dir, '../other')).toThrow();
  await manage({ action: 'remove', accountId: row.id });
  expect(await fs.readFile(path.join(profile, 'history'), 'utf8')).toBe('retained');
});
it('management binds only discovered existing profiles and rejects duplicate or injected ownership', async () => {
  const profiles = [{ browser: 'chrome' as const, directory: 'Profile 2', displayName: 'Work profile' }];
  const manage = createAccountManagement({ userDataPath: dir, openProfile: async () => undefined, listExistingProfiles: async () => profiles });
  const request = { action: 'create' as const, displayName: 'Work', browser: 'chrome' as const, existingProfileDirectory: 'Profile 2' };
  const results = await Promise.all([manage(request), manage(request)]);
  expect(results.filter(result => result.ok)).toHaveLength(1);
  expect(results.find(result => !result.ok)).toMatchObject({ error: 'Browser profile already belongs to an account' });
  const row = (await listAccounts())[0]!;
  expect(row).toMatchObject({ existingProfileDirectory: 'Profile 2', identity: null, paused: true, connected: false });
  expect(row.profileRef).toMatch(/^[a-f0-9-]{36}$/);
  expect(await manage({ ...request, existingProfileDirectory: '../Profile 2' })).toMatchObject({ ok: false });
  expect(await manage({ ...request, browser: 'edge' })).toMatchObject({ ok: false, error: 'Existing browser profile is unavailable' });
  resetAccountsForTests(); expect((await listAccounts())[0]!.existingProfileDirectory).toBe('Profile 2');
});
it('explicit reconnect reuses saved pairing without reviving old principals, identity or task authorization', async () => {
  const { row, principal, claim } = await active();
  resetAccountsForTests();
  expect((await getAccount(row.id))!.connected).toBe(false);
  expect(await authenticateAccount(row.id, claim.bridgeToken)).toBeNull();
  const reconnected = await reconnectAccount(row.id);
  expect(reconnected).toMatchObject({ id: row.id, profileRef: row.profileRef, connected: true, paused: true, identity: null });
  expect(await isAccountPrincipalCurrent(principal)).toBe(false);
  const current = (await authenticateAccount(row.id, claim.bridgeToken))!;
  expect(current.connectionVersion).toBeGreaterThan(principal.connectionVersion);
  await expect(assertAccountConnection(current)).rejects.toThrow();
  await expect(setAccountPaused(row.id, false)).rejects.toThrow('identity');
  const unpaired = await create('not-paired'); await expect(reconnectAccount(unpaired.id)).rejects.toThrow('pair this browser again');
});
