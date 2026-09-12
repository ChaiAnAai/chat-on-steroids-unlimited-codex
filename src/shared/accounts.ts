import type { ModelUsage } from './usage.js';
export const MAX_ACCOUNTS = 5;
export type AccountSurface = 'bridge' | 'core' | 'desktop' | 'plugins';
export interface AccountIdentity {
  providerId: string;
  workspaceId: string;
  displayLabel: string;
}
/** Safe for renderer projection: never contains credentials or pairing nonces. */
export interface Account {
  id: string;
  displayName: string;
  browser: 'chrome' | 'edge';
  profileRef: string;
  /** Existing standard browser profile basename; absent means an app-managed directory. */
  existingProfileDirectory?: string;
  identity: AccountIdentity | null;
  connectionVersion: number;
  connected: boolean;
  paused: boolean;
  createdAt: number;
}
export interface TrustedAccountPrincipal {
  accountId: string;
  connectionVersion: number;
  surface: AccountSurface;
}
export interface PendingAccountPairing {
  accountId: string;
  requestId: string;
  expiresAt: number;
  browser: Account['browser'];
  profileRef: string;
}
export interface ExistingBrowserProfile { browser: Account['browser']; directory: string; displayName: string }
export type AccountManagementRequest = { action: 'list' } | { action: 'create'; displayName: string; browser: Account['browser']; existingProfileDirectory?: string } |
  { action: 'prepare-pairing' | 'open' | 'reconnect' | 'pause' | 'disconnect' | 'remove'; accountId: string } |
  { action: 'confirm'; accountId: string; requestId: string };
export interface AccountManagementSnapshot {
  setup?: { accountId: string; expiresAt: number } | null;
  accounts: Account[];
  existingProfiles?: ExistingBrowserProfile[];
  pending: PendingAccountPairing[];
  /** Loopback locator only. No token, pairing nonce or provider credential. */
  bridgePort?: number | null;
  quotas?: Record<string, { state: 'fresh' | 'stale' | 'unknown'; observedAt: number | null; rows: ModelUsage[] }>;
  quotaPolicy?: { reservePercent: number; warningPercent: number };
  executionEnabled: false;
  blockers: string[];
}
export type AccountManagementResult = { ok: true; data: AccountManagementSnapshot } | { ok: false; error: string };
