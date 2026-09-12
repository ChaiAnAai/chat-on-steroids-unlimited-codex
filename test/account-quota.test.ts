import { beforeEach, afterEach, expect, it, vi } from 'vitest';

let usage: typeof import('../src/main/session/usage.js');
let now: number;
const row = (percent = 60) => ({ model: 'shared quota', scope: 'shared', remaining: null, remainingPercent: percent, resetAt: null, windowSeconds: 3600 });
beforeEach(async () => { vi.resetModules(); now = Date.parse('2026-09-12T12:00:00Z'); vi.spyOn(Date, 'now').mockImplementation(() => now); usage = await import('../src/main/session/usage.js'); });
afterEach(() => vi.restoreAllMocks());

it('never substitutes B or legacy quota for an unknown account A', () => {
  usage.observeUsage([row()], now, { accountId: 'b', connectionVersion: 7 });
  usage.observeUsage([row()], now);
  expect(usage.automationQuota('gpt-test', 10, 'a', 7)).toBe('quota-unknown');
  expect(usage.automationQuota('gpt-test', 10, 'b', 7)).toBeNull();
});

it('applies exhaustion only to the account whose quota was observed', () => {
  usage.observeUsage([row(5)], now, { accountId: 'a', connectionVersion: 7 });
  usage.observeUsage([row(80)], now, { accountId: 'b', connectionVersion: 7 });
  expect(usage.automationQuota('gpt-test', 10, 'a', 7)).toBe('quota-reserve');
  expect(usage.automationQuota('gpt-test', 10, 'b', 7)).toBeNull();
});

it('requires the current epoch instead of approving unknown or replaced connections', () => {
  usage.observeUsage([row()], now, { accountId: 'a', connectionVersion: 7 });
  expect(usage.automationQuota('gpt-test', 10, 'a', 8)).toBe('quota-unknown');
  expect(usage.automationQuota('gpt-test', 10, 'a')).toBe('quota-unknown');
});

it('does not let a delayed old epoch replace a current connection snapshot', () => {
  usage.observeUsage([row(5)], now, { accountId: 'a', connectionVersion: 8 });
  now++;
  usage.observeUsage([row(90)], now, { accountId: 'a', connectionVersion: 7 });
  expect(usage.automationQuota('gpt-test', 10, 'a', 8)).toBe('quota-reserve');
});

it('expires quota and clears it on process restart instead of persisting authorization', async () => {
  usage.observeUsage([row()], now, { accountId: 'a', connectionVersion: 7 });
  now += 600001;
  expect(usage.automationQuota('gpt-test', 10, 'a', 7)).toBe('quota-unknown');
  usage.observeUsage([row()], now, { accountId: 'a', connectionVersion: 7 });
  vi.resetModules(); usage = await import('../src/main/session/usage.js');
  expect(usage.automationQuota('gpt-test', 10, 'a', 7)).toBe('quota-unknown');
});
