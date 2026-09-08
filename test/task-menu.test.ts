import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { taskMenu, initTaskMenus } from '../src/renderer/task-menu.js';
import { initLanguagePicker, paintLanguagePicker } from '../src/renderer/language-picker.js';

let dom: JSDOM;
afterEach(() => { dom?.window.close(); vi.unstubAllGlobals(); });
function mount() {
  dom = new JSDOM(readFileSync('src/renderer/index.html', 'utf8'), { url: 'https://ui.test/' });
  for (const key of ['window', 'document', 'Node', 'Element']) vi.stubGlobal(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : (dom.window as any)[key]);
  return dom.window;
}
it('keeps existing task actions and supports keyboard navigation and outside dismissal', () => {
  const w = mount(); initTaskMenus();
  const row = w.document.createElement('div'); const actions = w.document.createElement('div'); row.append(actions); w.document.body.append(row);
  const run = vi.fn();
  for (const name of ['Pin task', 'Delete this recorded session']) { const button = w.document.createElement('button'); button.title = name; button.addEventListener('click', run); actions.append(button); }
  taskMenu(row, actions);
  const trigger = row.querySelector('summary')!;
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.focus(); trigger.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(w.document.activeElement).toBe(row.querySelector('button'));
  w.document.activeElement!.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  expect(w.document.activeElement).toBe(row.querySelectorAll('button')[1]);
  w.document.activeElement!.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(w.document.activeElement).toBe(trigger);
  expect(row.querySelector('details')!.open).toBe(false);
  row.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true }));
  const outside = w.document.createElement('button'); w.document.body.append(outside); outside.focus();
  expect(row.querySelector('details')!.open).toBe(false);
  row.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true }));
  row.querySelector('button')!.click(); expect(run).toHaveBeenCalledOnce();
  row.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true }));
  w.document.body.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  expect(row.querySelector('details')!.open).toBe(false);
});
it('chooses a named language rather than toggling an implicit pair', () => {
  const w = mount(); const save = vi.fn(async () => {});
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  initLanguagePicker(save); paintLanguagePicker('ja'); w.document.getElementById('languageBtn')!.click();
  expect(w.document.activeElement?.textContent).toBe('日本語');
  expect(w.document.querySelector('[data-language="ja"]')!.getAttribute('aria-checked')).toBe('true');
  w.document.querySelector<HTMLButtonElement>('[data-language="de"]')!.click();
  expect(save).toHaveBeenCalledWith('de');
});
