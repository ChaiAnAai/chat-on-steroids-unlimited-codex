import { JSDOM } from 'jsdom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const context = vi.hoisted(() => ({ key: 'selection-one', projectId: 'project-one', sessionId: 'session-one' }));
const append = vi.hoisted(() => vi.fn(() => true));
vi.mock('../src/renderer/chat.js', () => ({ skillChatContext: () => ({ ...context }), appendSkillDraft: append }));
import { mountSkillsPanel } from '../src/renderer/skills-panel.js';
const skill = { name: 'sample', title: 'Sample', description: 'A skill', version: '1', digest: 'a'.repeat(64), source: 'local', enabledProjects: ['project-one'], files: ['SKILL.md'], compatibility: '' };
let dom: JSDOM;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { dom = new JSDOM('<section id="skills"></section>'); Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node }); context.key = 'selection-one'; append.mockClear(); });
afterEach(() => dom.window.close());
it('prepares a pinned draft without sending or replacing the selected conversation', async () => {
  window.api = { skills: vi.fn().mockResolvedValue({ ok: true, data: { skills: [skill] } }) } as never;
  const back = vi.fn(), panel = mountSkillsPanel(document.getElementById('skills')!, back); await panel.refresh();
  const use = [...document.querySelectorAll('button')].find(button => button.textContent === 'Prepare in current chat')!; use.click(); await flush();
  expect(append).toHaveBeenCalledWith('selection-one', expect.stringContaining(`/skills/sample/${skill.digest}/SKILL.md`)); expect(back).toHaveBeenCalledOnce();
});
it('does not render a late snapshot into a different project selection', async () => {
  let resolve!: (value: unknown) => void;
  window.api = { skills: vi.fn(() => new Promise(r => { resolve = r; })) } as never;
  const panel = mountSkillsPanel(document.getElementById('skills')!, vi.fn()); const work = panel.refresh(); context.key = 'selection-two';
  resolve({ ok: true, data: { skills: [skill] } }); await work;
  expect(document.querySelector('.skill-card')).toBeNull();
});
it('keeps an import preview available after save failure and explicitly discards it on cancel', async () => {
  const manage = vi.fn().mockResolvedValueOnce({ ok: true, data: { token: 'preview-token', skill } }).mockResolvedValueOnce({ ok: false, error: 'Disk full' }).mockResolvedValueOnce({ ok: true, data: null });
  window.api = { skills: manage } as never; mountSkillsPanel(document.getElementById('skills')!, vi.fn());
  const button = (name: string) => [...document.querySelectorAll('button')].find(button => button.textContent === name)!;
  button('Import local folder').click(); await flush(); button('Confirm import').click(); await flush();
  expect((document.querySelector('.skill-import-preview') as HTMLElement).hidden).toBe(false); expect(document.querySelector('.operation-feedback')!.textContent).toContain('Disk full');
  button('Cancel').click(); await flush(); expect(manage).toHaveBeenLastCalledWith({ action: 'discard', token: 'preview-token' });
});
