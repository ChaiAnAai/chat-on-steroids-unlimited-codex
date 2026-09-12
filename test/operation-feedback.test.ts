import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { run } from '../src/renderer/dom.js';
let dom: JSDOM;
afterEach(() => dom?.window.close());
function mount() {
  dom = new JSDOM('<body><form><input /></form></body>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  return document.querySelector('form')!;
}
it('keeps IPC rejection and Promise exceptions beside their operation', async () => {
  const host = mount(); const retry = vi.fn();
  expect(await run(Promise.reject(new Error('Disk is unavailable')), { host, retry })).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Disk is unavailable');
  host.querySelector('button')!.click(); expect(retry).toHaveBeenCalledOnce();
  expect(await run(Promise.resolve({ ok: false, error: 'Save was rejected' }), { host })).toBeNull();
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(host.textContent).toContain('Save was rejected');
});
it('does not publish an old operation failure into a different selection', async () => {
  const host = mount();
  await run(Promise.resolve({ ok: false, error: 'Old session failed' }), { host, current: () => false });
  expect(host.textContent).toBe('');
  expect(document.querySelector('.toast')).toBeNull();
});

it('clears only the resolved operation while preserving other failures', async () => {
  const host = mount();
  await run(Promise.resolve({ ok: false, error: 'Send failed' }), { host, operation: 'send' });
  await run(Promise.resolve({ ok: false, error: 'Attachment failed' }), { host, operation: 'attach' });
  await run(Promise.resolve({ ok: true, data: true }), { host, operation: 'send' });
  expect(host.textContent).not.toContain('Send failed');
  expect(host.textContent).toContain('Attachment failed');
});
