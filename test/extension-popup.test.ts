import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');
let popup: JSDOM | undefined;
afterEach(() => { popup?.window.close(); });

function openPopup(reload: () => void, sendMessage?: (message: Record<string, unknown>) => Promise<unknown>) {
  popup = new JSDOM(html, { url: 'https://extension-popup.test/', runScripts: 'outside-only' });
  const unavailable = () => new Promise(() => undefined);
  Object.assign(popup.window, {
    chrome: { runtime: { reload, sendMessage: sendMessage ?? unavailable }, storage: { local: { get: unavailable } } },
    setInterval: () => 0
  });
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
    if (message.type === 'account_pair_claim') return { ok: true, paired: true, pending: false, identityPending: true };
    return new Promise(() => undefined);
  });
  const configuration = document.getElementById('accountConfiguration') as HTMLTextAreaElement; configuration.value = '{"accountId":"local-config"}';
  document.getElementById('accountRequestBtn')!.click();
  await vi.waitFor(() => expect(document.getElementById('accountPairStatus')!.textContent).toContain('cccccccc'));
  expect(requests.find(row => row.type === 'account_pair_request')).toEqual({ type: 'account_pair_request', configuration: configuration.value });
  document.getElementById('accountClaimBtn')!.click();
  await vi.waitFor(() => expect(document.getElementById('accountPairStatus')!.textContent).toContain('身份待验证'));
  expect(requests.find(row => row.type === 'account_pair_claim')).toEqual({ type: 'account_pair_claim' });
});
it('retains configuration and exposes manual retry after an unconfirmed claim without polling claim again', async () => {
  let claims = 0;
  const document = openPopup(vi.fn(), async message => {
    if (message.type === 'account_pair_request') return { ok: true, pending: true, expiresAt: Date.now() + 100000, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    if (message.type === 'account_pair_claim') { claims++; return { ok: false, error: 'pairing_pending_or_invalid', message: 'Confirm in 知行 first' }; }
    return new Promise(() => undefined);
  });
  const configuration = document.getElementById('accountConfiguration') as HTMLTextAreaElement; configuration.value = 'retained configuration';
  document.getElementById('accountRequestBtn')!.click(); await vi.waitFor(() => expect((document.getElementById('accountClaimBtn') as HTMLButtonElement).disabled).toBe(false));
  document.getElementById('accountClaimBtn')!.click(); await vi.waitFor(() => expect(document.getElementById('accountPairStatus')!.textContent).toContain('Confirm in 知行'));
  expect(configuration.value).toBe('retained configuration'); expect(claims).toBe(1); expect((document.getElementById('accountClaimBtn') as HTMLButtonElement).disabled).toBe(false);
});
