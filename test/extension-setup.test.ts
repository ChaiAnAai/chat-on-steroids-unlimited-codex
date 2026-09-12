import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { initExtensionSetup } from '../src/renderer/extension-setup.js';

let dom: JSDOM;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function mount() {
  dom = new JSDOM(readFileSync('src/renderer/index.html', 'utf8'));
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  const api = {
    extensionPath: vi.fn().mockResolvedValue({ ok: true, data: 'managed/extension' }),
    copyExtensionPath: vi.fn().mockResolvedValue({ ok: true, data: 'managed/extension' }),
    openExtensionFolder: vi.fn().mockResolvedValue({ ok: true, data: 'managed/extension' })
  };
  Object.assign(dom.window, { api });
  return api;
}
afterEach(() => { dom?.window.close(); vi.unstubAllGlobals(); });
it('uses backend path actions and never reports browser installation as complete', async () => {
  const api = mount(); initExtensionSetup(); await tick();
  const input = document.getElementById('extensionPath') as HTMLInputElement;
  expect(input.value).toBe('managed/extension');
  expect(input.readOnly).toBe(true);
  expect(document.getElementById('extensionSetupFeedback')!.textContent).toContain('still required');
  input.value = 'renderer/tampering';
  document.getElementById('bridgeCopyPath')!.click(); await tick();
  expect(api.copyExtensionPath).toHaveBeenCalledWith();
  expect(input.value).toBe('managed/extension');
  document.getElementById('bridgeFolder')!.click(); await tick();
  expect(api.openExtensionFolder).toHaveBeenCalledWith();
});
it('keeps missing-file and IPC failures visible and retries preparation without stale caching', async () => {
  const api = mount(); api.extensionPath.mockResolvedValueOnce({ ok: true, data: null });
  initExtensionSetup(); await tick();
  expect(document.getElementById('extensionSetupFeedback')!.textContent).toContain('missing');
  document.getElementById('bridgePrepare')!.click(); await tick();
  expect((document.getElementById('extensionPath') as HTMLInputElement).value).toBe('managed/extension');
  api.openExtensionFolder.mockRejectedValueOnce(new Error('Access denied'));
  document.getElementById('bridgeFolder')!.click(); await tick();
  expect(document.getElementById('extensionSetupFeedback')!.textContent).toContain('Access denied');
  expect((document.getElementById('extensionPath') as HTMLInputElement).value).toBe('');
  expect((document.getElementById('bridgePrepare') as HTMLButtonElement).disabled).toBe(false);
});
