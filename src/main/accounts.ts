import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { MAX_ACCOUNTS, type Account, type AccountSurface, type TrustedAccountPrincipal, type PendingAccountPairing } from '../shared/accounts.js';
import { durableStoreReady, readDurable, writeDurableNow } from './durable.js';
import { EXISTING_PROFILE_DIRECTORY } from './browser-profiles.js';
import { getSecret, setSecret, clearSecret, type SecretKey } from './secrets.js';

const identitySchema = z.object({ providerId: z.string().trim().min(1).max(256), workspaceId: z.string().trim().min(1).max(256), displayLabel: z.string().trim().min(1).max(160) });
const createSchema = z.object({ displayName: z.string().trim().min(1).max(160), browser: z.enum(['chrome', 'edge']), profileRef: z.string().trim().min(1).max(512), existingProfileDirectory: z.string().regex(EXISTING_PROFILE_DIRECTORY).optional() });
const accountSchema = createSchema.extend({ id: z.string().uuid(), identity: identitySchema.nullable(), connectionVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), connected: z.boolean(), paused: z.boolean(), createdAt: z.number().finite().nonnegative() });
const surfaces: AccountSurface[] = ['bridge', 'core', 'desktop', 'plugins'];
const PAIRING_TTL_MS = 120_000;
interface PendingPairing { nonce: string; requestId: string; expiresAt: number; connectionVersion: number; confirmed: boolean }
let registry: Account[] | null = null;
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, PendingPairing>();
let setup: { accountId: string; setupId: string; expiresAt: number; connectionVersion: number } | null = null;
/** A short-lived, explicitly selected locator, never a credential or login proof. */
export function prepareAccountSetup(id: string) {
  return serial(async () => {
    const row = find(id);
    setup = { accountId: id, setupId: randomUUID(), expiresAt: Date.now() + PAIRING_TTL_MS, connectionVersion: row.connectionVersion };
    return setupView();
  });
}
function setupView() {
  if (!setup) return null;
  const row = registry!.find(account => account.id === setup!.accountId);
  if (!row || setup.expiresAt <= Date.now() || row.connectionVersion !== setup.connectionVersion) return null;
  return { accountId: row.id, setupId: setup.setupId, expiresAt: setup.expiresAt, displayName: row.displayName, browser: row.browser, profileRef: row.profileRef };
}
export function accountSetupView() { return serial(async () => setupView()); }
export function accountPairingStatus(id: string, nonce: string) {
  return serial(async () => { const pair = pairing(id, nonce); return { confirmed: pair.confirmed, requestId: pair.requestId, expiresAt: pair.expiresAt }; });
}
const copy = <T>(value: T): T => structuredClone(value);
function key(id: string, surface: AccountSurface): SecretKey { return `account:${id}:${surface}`; }
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => { await initialize(); return operation(); });
  queue = run.catch(() => undefined);
  return run;
}
async function initialize(): Promise<void> {
  if (registry) return;
  if (!durableStoreReady()) throw new Error('Account storage is not initialized');
  const raw = await readDurable<unknown>('accounts');
  const parsed = z.array(accountSchema).max(MAX_ACCOUNTS).safeParse(raw ?? []);
  if (!parsed.success) throw new Error('Account registry is invalid; existing data was left untouched');
  const rows = parsed.data;
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => `${row.browser}:${row.profileRef}`)).size !== rows.length) throw new Error('Account registry has duplicate ownership');
  const existing = rows.filter(row => row.existingProfileDirectory).map(row => `${row.browser}:${row.existingProfileDirectory}`);
  if (new Set(existing).size !== existing.length) throw new Error('Account registry has duplicate ownership');
  const identities = rows.filter(row => row.identity).map(row => row.identity!.providerId);
  if (new Set(identities).size !== identities.length) throw new Error('Account registry has duplicate identity');
  // Disk records cannot prove a live browser after process restart. Persist revocation first.
  const restarted = rows.map(row => ({ ...row, connected: false, paused: true, connectionVersion: row.connectionVersion + 1 }));
  await writeDurableNow('accounts', restarted);
  registry = restarted;
  pending.clear();
}
function find(id: string): Account {
  const row = registry!.find(account => account.id === id);
  if (!row) throw new Error('Account not found');
  return row;
}
async function replace(row: Account): Promise<Account> {
  const rows = registry!.map(item => item.id === row.id ? row : item);
  await writeDurableNow('accounts', rows);
  registry = rows;
  return copy(row);
}
function principalCurrent(principal: TrustedAccountPrincipal, task = true): boolean {
  const row = registry!.find(account => account.id === principal.accountId);
  return !!row && surfaces.includes(principal.surface) && row.connectionVersion === principal.connectionVersion && row.connected && (!task || (!!row.identity && !row.paused));
}
function pairing(id: string, nonce: string): PendingPairing {
  const row = find(id), pair = pending.get(id);
  if (typeof nonce !== 'string' || nonce.length !== 64 || !pair || pair.expiresAt <= Date.now() || pair.connectionVersion !== row.connectionVersion || !equal(pair.nonce, nonce)) throw new Error('Pairing expired or superseded');
  return pair;
}
export function listAccounts(): Promise<Account[]> { return serial(async () => copy(registry!)); }
export function getAccount(id: string): Promise<Account | null> { return serial(async () => copy(registry!.find(row => row.id === id) ?? null)); }
export function createAccount(input: z.input<typeof createSchema>): Promise<Account> {
  return serial(async () => {
    const parsed = createSchema.parse(input);
    if (registry!.length >= MAX_ACCOUNTS) throw new Error('At most five accounts are supported');
    if (registry!.some(row => row.browser === parsed.browser && row.profileRef === parsed.profileRef)) throw new Error('Browser profile already belongs to an account');
    if (parsed.existingProfileDirectory && registry!.some(row => row.browser === parsed.browser && row.existingProfileDirectory === parsed.existingProfileDirectory)) throw new Error('Browser profile already belongs to an account');
    const row: Account = { ...parsed, id: randomUUID(), identity: null, connectionVersion: 0, connected: false, paused: true, createdAt: Date.now() };
    const rows = [...registry!, row]; await writeDurableNow('accounts', rows); registry = rows;
    return copy(row);
  });
}
/** Bridge request only. The renderer may display account metadata but never receives this nonce. */
export function requestAccountPairing(id: string, profile: Pick<Account, 'browser' | 'profileRef'>, setupId?: string): Promise<{ nonce: string; requestId: string; expiresAt: number }> {
  return serial(async () => {
    const row = find(id);
    if (setupId !== undefined && (setupView()?.setupId !== setupId || setup?.accountId !== id)) throw new Error('Pairing expired or superseded');
    if (row.browser !== profile.browser || row.profileRef !== profile.profileRef) throw new Error('Pairing profile does not match');
    const existing = pending.get(id);
    if (existing && existing.expiresAt > Date.now()) throw new Error('Pairing already pending');
    const pair = { nonce: randomBytes(32).toString('hex'), requestId: randomUUID(), expiresAt: Date.now() + PAIRING_TTL_MS, connectionVersion: row.connectionVersion, confirmed: setupId !== undefined };
    pending.set(id, pair); return { nonce: pair.nonce, requestId: pair.requestId, expiresAt: pair.expiresAt };
  });
}
/** Trusted main-process confirmation; do not expose nonce or tokens over renderer IPC. */
export function confirmAccountPairing(id: string, nonce: string): Promise<Account> {
  return serial(() => confirmPairing(id, nonce));
}
async function confirmPairing(id: string, nonce: string): Promise<Account> {
    const pair = pairing(id, nonce), row = find(id);
    if (pair.confirmed) return copy(row);
    const updated = await replace({ ...row, connected: false, paused: true, connectionVersion: row.connectionVersion + 1 });
    pair.connectionVersion = updated.connectionVersion; pair.confirmed = true;
    return updated;
}
export function listPendingAccountPairings(): Promise<PendingAccountPairing[]> {
  return serial(async () => [...pending.entries()].flatMap(([id, pair]) => {
    const row = find(id);
    return pair.expiresAt > Date.now() && pair.connectionVersion === row.connectionVersion && !pair.confirmed ? [{ accountId: id, requestId: pair.requestId, expiresAt: pair.expiresAt, browser: row.browser, profileRef: row.profileRef }] : [];
  }));
}
export function confirmPendingAccountPairing(id: string, requestId: string): Promise<Account> {
  return serial(async () => {
    const pair = pending.get(id);
    if (!pair || pair.requestId !== requestId) throw new Error('Pairing request has changed');
    return confirmPairing(id, pair.nonce);
  });
}
/** Only the extension that holds the nonce can claim the bridge token, exactly once. */
export function claimAccountPairing(id: string, nonce: string): Promise<{ accountId: string; connectionVersion: number; bridgeToken: string }> {
  return serial(async () => {
    const pair = pairing(id, nonce);
    if (!pair.confirmed) throw new Error('Pairing requires main-process confirmation');
    const tokens = Object.fromEntries(surfaces.map(surface => [surface, randomBytes(32).toString('hex')])) as Record<AccountSurface, string>;
    // Credentials are persisted before connected is published; partial failure remains disconnected.
    for (const surface of surfaces) await setSecret(key(id, surface), tokens[surface]);
    const row = await replace({ ...find(id), connected: true, paused: true });
    pending.delete(id);
    return { accountId: id, connectionVersion: row.connectionVersion, bridgeToken: tokens.bridge };
  });
}
export function authenticateAccount(id: string, token: string, surface: AccountSurface = 'bridge'): Promise<TrustedAccountPrincipal | null> {
  return serial(async () => {
    const row = registry!.find(account => account.id === id);
    if (!row?.connected || !surfaces.includes(surface) || typeof token !== 'string' || token.length !== 64) return null;
    const stored = await getSecret(key(id, surface));
    return stored && equal(stored, token) ? { accountId: id, connectionVersion: row.connectionVersion, surface } : null;
  });
}
export function isAccountPrincipalCurrent(principal: TrustedAccountPrincipal): Promise<boolean> { return serial(async () => principalCurrent(principal)); }
export async function assertAccountConnection(principal: TrustedAccountPrincipal): Promise<void> {
  if (!await isAccountPrincipalCurrent(principal)) throw new Error('Account identity, connection or authorization is no longer current');
}
export function setAccountIdentity(principal: TrustedAccountPrincipal, identity: z.input<typeof identitySchema>): Promise<Account> {
  return serial(async () => {
    if (principal.surface !== 'bridge' || !principalCurrent(principal, false)) throw new Error('Identity requires the current authenticated browser');
    const parsed = identitySchema.parse(identity), row = find(principal.accountId);
    if (registry!.some(other => other.id !== row.id && other.identity?.providerId === parsed.providerId)) {
      pending.delete(row.id);
      await replace({ ...row, connected: false, paused: true, identity: null, connectionVersion: row.connectionVersion + 1 });
      throw new Error('Provider identity already belongs to another account');
    }
    const changed = row.identity && (row.identity.providerId !== parsed.providerId || row.identity.workspaceId !== parsed.workspaceId);
    return replace({ ...row, identity: parsed, ...(changed ? { paused: true, connectionVersion: row.connectionVersion + 1 } : {}) });
  });
}
export function setAccountPaused(id: string, paused: boolean): Promise<Account> {
  return serial(async () => {
    z.boolean().parse(paused);
    const row = find(id);
    if (!paused && (!row.connected || !row.identity)) throw new Error('Verify the connected account identity before resuming');
    pending.delete(id);
    return replace({ ...row, paused, connectionVersion: row.connectionVersion + 1 });
  });
}
export function disconnectAccount(id: string): Promise<Account> {
  return serial(async () => { const row = find(id); pending.delete(id); return replace({ ...row, connected: false, paused: true, connectionVersion: row.connectionVersion + 1 }); });
}
/** Explicit trusted-main action only. Reuses the saved profile/credential binding, never task authorization. */
export function reconnectAccount(id: string): Promise<Account> {
  return serial(async () => {
    const row = find(id);
    for (const surface of surfaces) if (!await getSecret(key(id, surface))) throw new Error('Saved pairing is unavailable; pair this browser again');
    pending.delete(id);
    return replace({ ...row, connected: true, paused: true, identity: null, connectionVersion: row.connectionVersion + 1 });
  });
}
export function removeAccount(id: string): Promise<void> {
  return serial(async () => {
    find(id); pending.delete(id); const rows = registry!.filter(row => row.id !== id);
    await writeDurableNow('accounts', rows); registry = rows;
    // No browser profile or conversation history is deleted. Registry removal revokes all tokens.
    for (const surface of surfaces) await clearSecret(key(id, surface));
  });
}
export function getAccountMcpToken(id: string, surface: Exclude<AccountSurface, 'bridge'>): Promise<string | null> {
  return serial(async () => {
    if (!surfaces.includes(surface) || (surface as string) === 'bridge') return null;
    const row = find(id);
    if (!principalCurrent({ accountId: id, connectionVersion: row.connectionVersion, surface })) return null;
    return getSecret(key(id, surface));
  });
}
export function resolveMcpAccountToken(surface: Exclude<AccountSurface, 'bridge'>, token: string): Promise<TrustedAccountPrincipal | null> {
  return serial(async () => {
    if (!surfaces.includes(surface) || (surface as string) === 'bridge' || typeof token !== 'string' || token.length !== 64) return null;
    for (const row of registry!) {
      const principal = { accountId: row.id, connectionVersion: row.connectionVersion, surface };
      if (!principalCurrent(principal)) continue;
      const stored = await getSecret(key(row.id, surface));
      if (stored && equal(stored, token)) return principal;
    }
    return null;
  });
}
/** Only after all operations settle; simulates a new process against the same durable files. */
export function resetAccountsForTests(): void { registry = null; setup = null; pending.clear(); queue = Promise.resolve(); }
