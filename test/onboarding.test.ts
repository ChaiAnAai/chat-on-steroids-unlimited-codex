import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProxyManagementResult } from '../src/shared/proxy-management.js';
import type { ConnectionGuideState } from '../src/renderer/onboarding.js';
let dom: JSDOM;
beforeEach(() => {
  vi.resetModules(); dom = new JSDOM('<body><main></main></body>', { url: 'https://local.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node });
});
afterEach(() => dom.window.close());
const result: ProxyManagementResult = { ok: true, data: { endpoint: 'http://127.0.0.1:8317', executable: null,
  managementCredentialSaved: true, apiCredentialSaved: false, connection: 'not-configured', version: null, compatible: null } };
async function setup(proxy = vi.fn(async (): Promise<ProxyManagementResult> => result), changeLanguage = vi.fn(async (_language: 'en' | 'zh-CN') => undefined)) {
  const { mountConnectionGuide } = await import('../src/renderer/onboarding.js');
  const navigate = vi.fn(); const snapshot = vi.fn<() => ConnectionGuideState>(() => ({ language: 'en', workspaceReady: true, extensionReady: false, connectorReady: false }));
  const guide = mountConnectionGuide(document.querySelector('main')!, { snapshot, navigate, changeLanguage, proxy });
  return { guide, navigate, proxy, snapshot, changeLanguage, button: (text: string) => [...document.querySelectorAll('button')].find(button => button.textContent === text)! };
}
describe('connection guide', () => {
  it('projects existing readiness and never probes or opens a conversation during mounting and refresh', async () => {
    const { guide, proxy, navigate } = await setup(); guide.refresh();
    expect(proxy).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.connection-guide-status-row')).toHaveLength(3); expect(document.querySelector('.connection-guide')?.getAttribute('data-ready')).toBe('false');
    expect(document.querySelector('.connection-guide')?.classList.contains('pane')).toBe(false);
  });
  it('retains credentials on failure, displays a local error and permits explicit retry', async () => {
    const proxy = vi.fn(async (): Promise<ProxyManagementResult> => ({ ok: false, error: 'Secure storage unavailable' }));
    const { button } = await setup(proxy); const input = document.querySelector('input[type=password]') as HTMLInputElement;
    input.value = 'private-input'; button('Save connection').click();
    await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toContain('Secure storage unavailable'));
    expect(input.value).toBe('private-input'); expect(button('Save connection').disabled).toBe(false);
  });
  it('does not clear a newer credential draft when an earlier save completes', async () => {
    let resolve!: (result: ProxyManagementResult) => void;
    const proxy = vi.fn(() => new Promise<ProxyManagementResult>(done => { resolve = done; }));
    const { button } = await setup(proxy); const input = document.querySelector('input[type=password]') as HTMLInputElement;
    input.value = 'old-private-input'; button('Save connection').click(); input.value = 'new-private-input';
    resolve(result); await vi.waitFor(() => expect(button('Save connection').disabled).toBe(false));
    expect(input.value).toBe('new-private-input'); expect(document.body.textContent).not.toContain('private-input');
  });
  it('does not publish an asynchronous response into a disposed guide', async () => {
    let resolve!: (result: ProxyManagementResult) => void;
    const proxy = vi.fn(() => new Promise<ProxyManagementResult>(done => { resolve = done; }));
    const { guide, button } = await setup(proxy); button('Check connection').click(); guide.destroy();
    resolve(result); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('main')?.textContent).toBe(''); expect(document.querySelector('[role=alert]')).toBeNull();
  });
  it('routes each overview action to its specific settings and refreshes status without replacing controls', async () => {
    const { button, navigate, guide, snapshot, proxy } = await setup();
    const language = document.querySelector('.connection-guide-language-select');
    button('Manage folders').click(); button('Set up extension').click(); button('Manage connection').click();
    expect(navigate.mock.calls).toEqual([['workspace'], ['extension'], ['connector']]); expect(proxy).not.toHaveBeenCalled();
    snapshot.mockReturnValue({ language: 'en', workspaceReady: true, extensionReady: true, connectorReady: true }); guide.refresh();
    expect(document.querySelector('.connection-guide-language-select')).toBe(language);
    expect([...document.querySelectorAll('.connection-guide-state')].map(node => node.textContent)).toEqual(['Ready', 'Ready', 'Ready']);
    expect(document.querySelector('.connection-guide')?.getAttribute('data-ready')).toBe('true');
  });
  it('retains the failed language selection across refresh and offers explicit retry next to it', async () => {
    const changeLanguage = vi.fn(async (_language: 'en' | 'zh-CN') => undefined).mockRejectedValueOnce(new Error('save failed'));
    const { guide, button } = await setup(undefined, changeLanguage);
    const language = document.querySelector('.connection-guide-language-select') as HTMLSelectElement;
    language.value = 'zh-CN'; language.dispatchEvent(new dom.window.Event('change'));
    await vi.waitFor(() => expect(document.querySelector('.connection-guide-language-status')?.textContent).toContain('Not saved'));
    guide.refresh(); guide.refresh();
    expect(language.value).toBe('zh-CN'); expect(language.disabled).toBe(false);
    expect(button('Retry').hidden).toBe(false); button('Retry').click();
    await vi.waitFor(() => expect(changeLanguage).toHaveBeenCalledTimes(2));
    expect(changeLanguage.mock.calls).toEqual([['zh-CN'], ['zh-CN']]);
    expect(language.value).toBe('zh-CN');
  });
  it('keeps a confirmed language choice until its state snapshot arrives, then follows subsequent saved changes', async () => {
    const { guide, snapshot } = await setup();
    const language = document.querySelector('.connection-guide-language-select') as HTMLSelectElement;
    language.value = 'zh-CN'; language.dispatchEvent(new dom.window.Event('change'));
    await vi.waitFor(() => expect(language.disabled).toBe(false));
    guide.refresh(); expect(language.value).toBe('zh-CN');
    snapshot.mockReturnValue({ language: 'zh-CN', workspaceReady: true, extensionReady: false, connectorReady: false }); guide.refresh();
    snapshot.mockReturnValue({ language: 'en', workspaceReady: true, extensionReady: false, connectorReady: false }); guide.refresh();
    expect(language.value).toBe('en');
  });
  it('does not touch proxy drafts or their error feedback when overview status changes', async () => {
    const proxy = vi.fn(async (): Promise<ProxyManagementResult> => ({ ok: false, error: 'Secure storage unavailable' }));
    const { guide, button, snapshot } = await setup(proxy);
    const endpoint = document.querySelector('.connection-guide-proxy input') as HTMLInputElement;
    const key = document.querySelector('input[type=password]') as HTMLInputElement;
    endpoint.value = 'https://my-proxy.example'; key.value = 'draft-key'; button('Save connection').click();
    await vi.waitFor(() => expect(document.querySelector('.connection-guide-proxy [role=alert]')?.textContent).toContain('Secure storage unavailable'));
    snapshot.mockReturnValue({ language: 'en', workspaceReady: true, extensionReady: true, connectorReady: true, proxyEndpoint: 'https://old-saved.example' }); guide.refresh();
    expect(endpoint.value).toBe('https://my-proxy.example'); expect(key.value).toBe('draft-key');
    expect(document.querySelector('.connection-guide-proxy [role=alert]')?.textContent).toContain('Secure storage unavailable');
  });
  it('keeps the language control and proxy inputs attached when translated labels repaint', async () => {
    const { snapshot, guide } = await setup();
    const language = document.querySelector('.connection-guide-language-select');
    snapshot.mockReturnValue({ language: 'en', workspaceReady: true, extensionReady: false, connectorReady: false }); guide.refresh();
    const key = document.querySelector('input[type=password]') as HTMLInputElement; key.value = 'retained-draft';
    const { setLanguage } = await import('../src/renderer/i18n.js');
    setLanguage('zh-CN', false);
    expect(document.querySelector('.connection-guide-language-select')).toBe(language);
    expect(document.querySelector('.connection-guide-label')?.textContent).toContain('语言');
    expect(document.querySelector('[data-section=workspace] .connection-guide-state')?.textContent).toBe('已就绪');
    expect(key.isConnected).toBe(true); expect(key.value).toBe('retained-draft');
  });
});
