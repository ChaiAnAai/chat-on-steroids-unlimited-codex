import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { paintSetupGuide } from '../src/renderer/setup-guide.js';
let dom: JSDOM;
afterEach(() => { dom?.window.close(); vi.unstubAllGlobals(); });
function mount() {
  dom = new JSDOM(readFileSync('src/renderer/index.html', 'utf8'));
  vi.stubGlobal('document', dom.window.document);
  return dom.window.document;
}
it('shows the current step, supports reviewing completed steps and counts only applicable steps', () => {
  const doc = mount();
  paintSetupGuide('folder', false);
  expect(doc.querySelectorAll('.setup-step-content:not([hidden])')).toHaveLength(1);
  expect(doc.querySelectorAll('#tunnelKind')).toHaveLength(1);
  expect(doc.querySelector('#tunnelKind')!.closest('.advanced')).toBeNull();
  doc.querySelector('[data-step=folder]')!.classList.add('is-done');
  for (const name of ['tunnel', 'key']) (doc.querySelector(`[data-step=${name}]`) as HTMLElement).hidden = true;
  paintSetupGuide('connect', false);
  expect(doc.getElementById('setupProgress')!.textContent).toBe('1 / 4');
  expect(doc.getElementById('setup-content-folder')!.hidden).toBe(true);
  (doc.querySelector('[data-step=folder] h3 button') as HTMLButtonElement).click();
  expect(doc.getElementById('setup-content-folder')!.hidden).toBe(false);
  paintSetupGuide('connect', false);
  expect(doc.getElementById('setup-content-folder')!.hidden).toBe(false);
});
it('does not hide focused edits when progress advances or claim an optional connector is complete', () => {
  const doc = mount(); paintSetupGuide('key', false);
  doc.getElementById('apiKey')!.focus();
  paintSetupGuide('connect', false);
  expect(doc.getElementById('setup-content-key')!.hidden).toBe(false);
  expect(doc.activeElement).toBe(doc.getElementById('apiKey'));
  doc.querySelector('[data-step=chatgpt]')!.classList.add('is-done');
  doc.getElementById('connectorCards')!.classList.add('has-unfinished');
  paintSetupGuide(null, false);
  expect(doc.getElementById('setup-content-chatgpt')!.hidden).toBe(false);
});
