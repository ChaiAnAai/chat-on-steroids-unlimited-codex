import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
const localeScript = await readFile(new URL('../extension/popup-i18n.js', import.meta.url), 'utf8');
let popup: JSDOM | undefined;
afterEach(() => { popup?.window.close(); });

function openPopup(reload: () => void, sendMessage?: (message: Record<string, unknown>) => Promise<unknown>, language = 'en', saved = {}) {
  popup = new JSDOM(html, { url: 'https://extension-popup.test/', runScripts: 'outside-only' });
  const unavailable = () => new Promise(() => undefined);
  Object.assign(popup.window, {
    chrome: { i18n: { getUILanguage: () => language }, runtime: { reload, sendMessage: sendMessage ?? unavailable }, storage: { local: { get: async () => saved, set: async () => undefined } } },
    setInterval: () => 0
  });
  popup.window.eval(localeScript);
  popup.window.eval(script);
  return popup.window.document;
}

it('reloads only on explicit click even when the worker is unavailable', () => {
  const reload = vi.fn();
  const document = openPopup(reload);
  expect(reload).not.toHaveBeenCalled();
  document.getElementById('reloadBtn')!.click();
  expect(reload).toHaveBeenCalledTimes(1);
});

it('reports only app reachability from compatible health and pairing', () => {
  const document = openPopup(vi.fn());
  expect(document.getElementById('pill')!.classList.contains('off')).toBe(true);
  (popup!.window as any).paintHeader({ connected: true, paired: true, port: 8765 });
  expect(document.getElementById('state')!.textContent).not.toContain('Connected');
  (popup!.window as any).paintHeader({ connected: true, paired: true, compatible: true, port: 8765 });
  expect(document.getElementById('state')!.textContent).toBe('App reachable · Port 8765');
  expect(document.getElementById('state')!.textContent).not.toContain('Connected');
  (popup!.window as any).paintHeader({ connected: false });
  expect(document.getElementById('state')!.textContent).toBe('App not reachable');
});

it('explains manual mismatch recovery with both versions and keeps reload available', () => {
  const document = openPopup(vi.fn());
  (popup!.window as any).paintAlert({ connected: true, paired: true, compatible: false, appVersion: '2.0.7', appProtocol: 13, extensionVersion: '2.0.6', extensionProtocol: 12 }, null);
  const alert = document.getElementById('alert')!;
  expect(alert.textContent).toContain('2.0.7'); expect(alert.textContent).toContain('2.0.6');
  expect(alert.textContent).toContain('protocol 13'); expect(alert.textContent).toContain('protocol 12');
  expect(alert.textContent).toContain('Developer mode'); expect(alert.textContent).toContain('Open extension folder');
  expect(document.getElementById('reloadBtn')).not.toBeNull();
});

it('requires this chat session receipt before claiming delivery even with global delivery success', () => {
  openPopup(vi.fn());
  const info = { isChat: true, recorder: true, page: { events: 3 }, pending: 0, delivery: { ok: true, total: 50 } };
  const waiting = (popup!.window as any).pipeline(info, true);
  expect(waiting.sent[0]).toBe('running');
  expect(waiting.proc[0]).toBe('running');
  expect(waiting.why[1]).toContain('this chat’s session receipt');
  const recorded = (popup!.window as any).pipeline({ ...info, page: { events: 3, session: 'local-session' } }, true);
  expect(recorded.sent[0]).toBe('done');
  expect(recorded.proc[0]).toBe('done');
});

it('keeps blocked delivery distinct from network unreachability and requires pairing too', () => {
  const document = openPopup(vi.fn());
  (popup!.window as any).paintHeader({ connected: true, paired: false, compatible: true, port: 8765 });
  expect(document.getElementById('state')!.textContent).not.toContain('Connected');
  const result = (popup!.window as any).pipeline({ isChat: true, recorder: true, page: { events: 1 }, pending: 1 }, false);
  expect(result.why[1]).toContain('protocol compatibility');
  expect(result.why[1]).not.toContain('not reachable');
});
it('shows the safe request ID for main confirmation and never receives the claim credential', async () => {
  const requests: Record<string, unknown>[] = [];
  const document = openPopup(vi.fn(), async message => {
    requests.push(message);
    if (message.type === 'account_pair_request') return { ok: true, pending: true, expiresAt: Date.now() + 100000, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    if (message.type === 'account_pair_status') return { ok: true, paired: true, pending: false, identityPending: true };
    return new Promise(() => undefined);
  });
  const configuration = document.getElementById('accountConfiguration') as HTMLTextAreaElement; configuration.value = '{"accountId":"local-config"}';
  document.getElementById('accountRequestBtn')!.click();
  await vi.waitFor(() => expect(document.getElementById('accountPairStatus')!.textContent).toContain('cccccccc'));
  expect(requests.find(row => row.type === 'account_pair_request')).toEqual({ type: 'account_pair_request', configuration: configuration.value });
  document.getElementById('accountClaimBtn')!.click();
  await vi.waitFor(() => expect(document.getElementById('accountPairStatus')!.textContent).toContain('Login identity still needs verification'));
  expect(requests.find(row => row.type === 'account_pair_status')).toEqual({ type: 'account_pair_status' });
});
it('retains advanced configuration and allows a status recheck without requesting another pairing', async () => {
  let claims = 0;
  const document = openPopup(vi.fn(), async message => {
    if (message.type === 'account_pair_request') return { ok: true, pending: true, expiresAt: Date.now() + 100000, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    if (message.type === 'account_pair_status') { claims++; return { ok: false, error: 'pairing_pending_or_invalid', message: 'Confirm in 知行 first' }; }
    return new Promise(() => undefined);
  });
  const configuration = document.getElementById('accountConfiguration') as HTMLTextAreaElement; configuration.value = 'retained configuration';
  document.getElementById('accountRequestBtn')!.click(); await vi.waitFor(() => expect((document.getElementById('accountClaimBtn') as HTMLButtonElement).disabled).toBe(false));
  document.getElementById('accountClaimBtn')!.click(); await vi.waitFor(() => expect(document.getElementById('accountPairStatus')!.textContent).toContain('Confirm the matching request'));
  expect(configuration.value).toBe('retained configuration'); expect(claims).toBeGreaterThanOrEqual(1); expect((document.getElementById('accountClaimBtn') as HTMLButtonElement).disabled).toBe(false);
});

it('follows Chinese browser UI language, falls back to English and keeps manual configuration collapsed', () => {
  let document = openPopup(vi.fn(), undefined, 'zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN'); expect(document.getElementById('accountFindBtn')!.textContent).toBe('查找知行');
  expect((document.getElementById('manualPairing') as HTMLDetailsElement).open).toBe(false);
  (popup!.window as any).paintHeader({ needsSetup: true }); expect(document.getElementById('state')!.textContent).toBe('需要连接账号');
  popup!.window.close(); document = openPopup(vi.fn(), undefined, 'fr-FR');
  expect(document.documentElement.lang).toBe('en'); expect(document.getElementById('accountFindBtn')!.textContent).toBe('Find app');
});
it('honors an explicit language choice and leaves account JSON and identifiers unchanged', async () => {
  const document = openPopup(vi.fn(), undefined, 'zh-CN', { popupLanguage: 'en' });
  await vi.waitFor(() => expect(document.documentElement.lang).toBe('en'));
  const input = document.getElementById('accountConfiguration') as HTMLTextAreaElement; input.value = '{"browser":"chrome","accountId":"unchanged"}';
  const select = document.getElementById('languageSelect') as HTMLSelectElement;
  select.value = 'zh-CN'; select.dispatchEvent(new popup!.window.Event('change'));
  expect(document.documentElement.lang).toBe('zh-CN'); expect(document.getElementById('accountFindBtn')!.textContent).toBe('查找知行');
  expect(input.value).toBe('{"browser":"chrome","accountId":"unchanged"}');
  select.value = 'system'; select.dispatchEvent(new popup!.window.Event('change')); expect(document.documentElement.lang).toBe('zh-CN');
});
it('connects a selected invitation without exposing JSON or automatically selecting another app', async () => {
  const requests: Record<string, unknown>[] = [];
  const document = openPopup(vi.fn(), async message => {
    requests.push(message);
    if (message.type === 'account_pair_discover') return { ok: true, candidates: [{ displayName: 'Work', setupId: 'invitation', configuration: { browser: 'chrome', port: 18765 } }] };
    if (message.type === 'account_pair_connect') return { ok: true, pending: true, expiresAt: Date.now() + 100000, requestId: 'request-id' };
    return new Promise(() => undefined);
  }, 'zh-CN');
  document.getElementById('accountFindBtn')!.click();
  await vi.waitFor(() => expect(document.querySelector('#accountCandidates button')).not.toBeNull());
  expect(requests.some(row => row.type === 'account_pair_connect')).toBe(false);
  (document.querySelector('#accountCandidates button') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(requests).toContainEqual({ type: 'account_pair_connect', setupId: 'invitation', port: 18765 }));
  expect((document.getElementById('accountConfiguration') as HTMLTextAreaElement).value).toBe('');
});
