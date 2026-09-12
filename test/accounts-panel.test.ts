import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountManagementResult } from '../src/shared/accounts.js';
import { mountAccountsPanel } from '../src/renderer/accounts-panel.js';
let dom: JSDOM;
beforeEach(() => { dom = new JSDOM('<body><button id="entry">Accounts</button><main></main></body>'); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('HTMLElement', dom.window.HTMLElement); });
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });
const empty: AccountManagementResult = { ok: true, data: { accounts: [], pending: [], executionEnabled: false, blockers: ['parallel-execution-unverified'] } };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
it('returns to the navigation toggle when its entry drawer closed while the panel was open', async () => {
  const toggle = document.createElement('button'); toggle.id = 'sidebarToggle'; document.body.prepend(toggle);
  const entry = document.getElementById('entry')!; entry.focus();
  const panel = mountAccountsPanel(document.querySelector('main')!, { manage: async () => empty, language: () => 'en' });
  panel.open(); await settle(); entry.setAttribute('hidden', '');
  panel.close(); expect(document.activeElement).toBe(toggle); panel.destroy();
});
it('submits an explicitly selected existing profile and preserves the selection after failure', async () => {
  const snapshot = { ...empty, data: { ...empty.data, existingProfiles: [{ browser: 'chrome' as const, directory: 'Profile 2', displayName: 'Work' }] } };
  const manage = vi.fn(async (): Promise<AccountManagementResult> => snapshot);
  const panel = mountAccountsPanel(document.querySelector('main')!, { manage, language: () => 'zh-CN' }); panel.open(); await settle();
  const select = document.querySelector<HTMLSelectElement>('.accounts-profile-choice select')!;
  expect(select.value).toBe(''); select.value = 'Profile 2'; document.querySelector('input')!.value = 'Named account';
  manage.mockResolvedValueOnce({ ok: false, error: 'Browser profile already belongs to an account' });
  document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
  expect(manage).toHaveBeenLastCalledWith({ action: 'create', browser: 'chrome', displayName: 'Named account', existingProfileDirectory: 'Profile 2' });
  expect(select.value).toBe('Profile 2'); expect(document.body.textContent).toContain('已接入');
  manage.mockResolvedValueOnce(empty); await panel.refresh(); expect(select.value).toBe('Profile 2'); expect(select.selectedOptions[0]!.textContent).toContain('不可用');
  panel.destroy();
});
it('opens only on request, keeps execution unavailable and returns focus on Esc', async () => {
  const manage = vi.fn(async (): Promise<AccountManagementResult> => empty); const panel = mountAccountsPanel(document.querySelector('main')!, { manage, language: () => 'zh-CN' });
  expect(manage).not.toHaveBeenCalled(); document.querySelector<HTMLElement>('#entry')!.focus(); panel.open(); await settle();
  expect(manage).toHaveBeenCalledWith({ action: 'list' }); expect(document.body.textContent).toContain('并行执行尚未完成验收');
  document.querySelector('section')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.activeElement?.id).toBe('entry'); expect(document.querySelector('section')!.hidden).toBe(true); panel.destroy();
});
it('retains failed/newer drafts and never paints a response from a closed panel', async () => {
  let resolve!: (value: AccountManagementResult) => void;
  const manage = vi.fn(async (): Promise<AccountManagementResult> => empty); const panel = mountAccountsPanel(document.querySelector('main')!, { manage, language: () => 'en' }); panel.open(); await settle();
  manage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const input = document.querySelector('input')!; input.value = 'Before';
  document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); input.value = 'Newer'; resolve(empty); await settle(); expect(input.value).toBe('Newer');
  manage.mockResolvedValueOnce({ ok: false, error: 'test failure' }); document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await settle();
  expect(input.value).toBe('Newer'); expect(document.querySelector('[role=status]')!.textContent).toContain('failed');
  manage.mockImplementationOnce(() => new Promise(done => { resolve = done; })); void panel.refresh(); panel.close(); const before = document.querySelector('[role=status]')!.textContent; resolve(empty); await settle();
  expect(document.querySelector('[role=status]')!.textContent).toBe(before); panel.destroy();
});
it('shows observed identity separately and cannot send task activation despite paired account', async () => {
  const result: AccountManagementResult = { ok: true, data: { ...empty.data, accounts: [{ id: 'test', displayName: 'Local name', browser: 'edge', profileRef: 'test', identity: null, connectionVersion: 1, connected: true, paused: true, createdAt: 0 }] } };
  const manage = vi.fn(async () => result); const panel = mountAccountsPanel(document.querySelector('main')!, { manage, language: () => 'en' }); panel.open(); await settle();
  expect(document.body.textContent).toContain('Login identity unknown');
  const activate = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Start tasks'))!; expect(activate.disabled).toBe(true); activate.click(); expect(manage).toHaveBeenCalledTimes(1); panel.destroy();
});
it('provides only non-secret profile routing data and an explicit pairing guide', async () => {
  const account = { id: 'b5ce91f0-ecc3-4574-9e15-18134759501f', displayName: 'Work', browser: 'chrome' as const, profileRef: 'd2a0fd8f-a74b-4fc1-8d03-8f548c370e0a', identity: null, connectionVersion: 3, connected: false, paused: true, createdAt: 0 };
  const result: AccountManagementResult = { ok: true, data: { ...empty.data, accounts: [account], bridgePort: 43123 } };
  const panel = mountAccountsPanel(document.querySelector('main')!, { manage: async () => result, language: () => 'zh-CN' }); panel.open(); await settle();
  const code = document.querySelector('textarea')!;
  expect(code.readOnly).toBe(true);
  expect(JSON.parse(code.value)).toEqual({ accountId: account.id, profileRef: account.profileRef, browser: 'chrome', port: 43123 });
  expect(document.querySelectorAll('.accounts-guide li')).toHaveLength(4);
  expect(document.querySelector('details')!.open).toBe(false);
  panel.destroy();
});
