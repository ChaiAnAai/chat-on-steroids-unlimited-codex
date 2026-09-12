import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Account, AccountManagementRequest, AccountManagementResult } from '../shared/accounts.js';
import { prepareAccountSetup, accountSetupView, confirmPendingAccountPairing, createAccount, disconnectAccount, getAccount, listAccounts, listPendingAccountPairings, reconnectAccount, removeAccount, setAccountPaused } from './accounts.js';
import { accountQuotaView } from './session/usage.js';
import { getConfig } from './config.js';
import { EXISTING_PROFILE_DIRECTORY, existingAccountBrowserTarget, listExistingBrowserProfiles } from './browser-profiles.js';

const uuid = z.string().uuid();
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('create'), displayName: z.string().trim().min(1).max(160), browser: z.enum(['chrome', 'edge']), existingProfileDirectory: z.string().regex(EXISTING_PROFILE_DIRECTORY).optional() }),
  z.object({ action: z.literal('prepare-pairing'), accountId: uuid }),
  z.object({ action: z.literal('open'), accountId: uuid }),
  z.object({ action: z.literal('reconnect'), accountId: uuid }),
  z.object({ action: z.literal('confirm'), accountId: uuid, requestId: uuid }),
  z.object({ action: z.literal('pause'), accountId: uuid }),
  z.object({ action: z.literal('disconnect'), accountId: uuid }),
  z.object({ action: z.literal('remove'), accountId: uuid })
]);
export interface AccountManagementDependencies {
  userDataPath: string;
  bridgePort?: () => number | null;
  ensureBridge?: () => Promise<number | null>;
  /** Launch only this owned profile. Opening is not login/pairing/identity proof. */
  openProfile: (account: Account, profileDirectory: string, profileName?: string) => Promise<void>;
  listExistingProfiles?: typeof listExistingBrowserProfiles;
}
/** UUID references only; renderer strings never select arbitrary filesystem paths. */
export function accountProfilePath(userDataPath: string, profileRef: string): string {
  return path.join(path.resolve(userDataPath), 'account-profiles', uuid.parse(profileRef));
}
export async function accountBrowserTarget(userDataPath: string, account: Account): Promise<{ profileDirectory: string; profileName?: string }> {
  return account.existingProfileDirectory ? existingAccountBrowserTarget(account) : { profileDirectory: accountProfilePath(userDataPath, account.profileRef) };
}
export function createAccountManagement(deps: AccountManagementDependencies): (request: AccountManagementRequest) => Promise<AccountManagementResult> {
  return async request => {
    try {
      const parsed = requestSchema.parse(request);
      if (parsed.action === 'create') {
        if (parsed.existingProfileDirectory && !(await (deps.listExistingProfiles ?? listExistingBrowserProfiles)()).some(row => row.browser === parsed.browser && row.directory === parsed.existingProfileDirectory)) throw new Error('Existing browser profile is unavailable');
        await createAccount({ displayName: parsed.displayName, browser: parsed.browser, profileRef: randomUUID(), ...(parsed.existingProfileDirectory ? { existingProfileDirectory: parsed.existingProfileDirectory } : {}) });
      }
      else if (parsed.action === 'prepare-pairing') {
        if (!(await deps.ensureBridge?.() ?? deps.bridgePort?.())) throw new Error('Browser bridge is unavailable');
        await prepareAccountSetup(parsed.accountId);
      }
      else if (parsed.action === 'open') {
        const account = await getAccount(parsed.accountId);
        if (!account) throw new Error('Account not found');
        const target = await accountBrowserTarget(deps.userDataPath, account);
        if (target.profileName) await deps.openProfile(account, target.profileDirectory, target.profileName);
        else await deps.openProfile(account, target.profileDirectory);
      } else if (parsed.action === 'confirm') await confirmPendingAccountPairing(parsed.accountId, parsed.requestId);
      else if (parsed.action === 'reconnect') await reconnectAccount(parsed.accountId);
      else if (parsed.action === 'pause') await setAccountPaused(parsed.accountId, true);
      else if (parsed.action === 'disconnect') await disconnectAccount(parsed.accountId);
      else if (parsed.action === 'remove') await removeAccount(parsed.accountId);
      const accounts = await listAccounts();
      const quotas = Object.fromEntries(await Promise.all(accounts.map(async account => [account.id, await accountQuotaView(account)] as const)));
      const goal = getConfig().goal;
      const existingProfiles = await (deps.listExistingProfiles ?? listExistingBrowserProfiles)();
      return { ok: true, data: { accounts, setup: await accountSetupView(), existingProfiles, quotas, quotaPolicy: { reservePercent: goal.reservePercent ?? 10, warningPercent: goal.warningPercent ?? 20 }, pending: await listPendingAccountPairings(), bridgePort: deps.bridgePort?.() ?? null, executionEnabled: false, blockers: ['parallel-execution-unverified'] } };
    } catch (error) {
      // Surface a bounded known error, never native process output or a credential-store payload.
      const safe = ['Browser bridge is unavailable', 'Existing browser profile is unavailable', 'Browser profile already belongs to an account', 'Account not found', 'At most five accounts are supported', 'Pairing request has changed', 'Pairing expired or superseded', 'Saved pairing is unavailable; pair this browser again'];
      return { ok: false, error: error instanceof Error && safe.includes(error.message) ? error.message : 'Account operation failed. Your profile and conversation history were retained; refresh and retry.' };
    }
  };
}
