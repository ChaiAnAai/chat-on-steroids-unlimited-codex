import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it } from 'vitest';
import { createWorkspace, readPresentation, recordedPatch, recordedTools, taskLabel, taskMatches, taskPhase } from '../src/renderer/workspace.js';
import type { SessionEvent, SessionSummary } from '../src/shared/session.js';
import { setUiLanguage } from '../src/renderer/i18n.js';

let dom: JSDOM | undefined;
afterEach(() => { dom?.window.close(); setUiLanguage('en'); });
const task = (id: string, title: string) => ({ id, title, lastTurnOutcome: null } as SessionSummary);
const stored = (text: string) => ({ text, truncated: false, chars: text.length });
const call = (id: string, kind: string) => ({ seq: 1, time: 1, kind: 'tool_call', call: {
  callId: id, tool: 'exec_command', summary: { title: id, kind, tone: 'neutral' }, outcome: 'ok', durationMs: 30,
  args: stored('{"cmd":"npm test"}'), result: stored('<script>must remain text</script>')
} } as SessionEvent);

it('validates optional local presentation and searches labels with project context without altering source titles', () => {
  const source = task('task-1', 'Provider title');
  const presentation = readPresentation({ getItem: () => JSON.stringify({ names: { 'task-1': '修复搜索', invalid: 42 }, pins: ['task-1', 4], collapsed: null }) });
  expect(presentation.pins).toEqual(['task-1']); expect(presentation.names.invalid).toBeUndefined();
  expect(taskLabel(source, presentation)).toBe('修复搜索'); expect(source.title).toBe('Provider title');
  expect(taskMatches(source, { id: 'project', name: 'Desktop', path: 'D:/repo', createdAt: 0 }, 'desktop 搜索', presentation)).toBe(true);
  expect(readPresentation({ getItem: () => { throw new Error('unavailable'); } }).pins).toEqual([]);
});

it('uses exact recorded activity categories and does not equate an idle task with completion', () => {
  expect(taskPhase(task('a', 'A'), false, false)).toBe('Ready');
  expect(taskPhase(task('a', 'A'), true, true)).toBe('Waiting for you');
  expect(taskPhase({ ...task('a', 'A'), lastTurnOutcome: 'failed' }, false, false)).toBe('Failed');
  const events = [call('read', 'read'), call('command', 'run'), call('edit', 'edit')];
  expect(recordedTools(events, 'commands').map(event => event.call.callId)).toEqual(['command']);
  expect(recordedTools(events, 'changes').map(event => event.call.callId)).toEqual(['edit']);
  expect(recordedPatch('{"path":"file.ts"}')).toBeNull();
  expect(recordedPatch(JSON.stringify({ patch: '*** Begin Patch\n+added\n-removed' }))).toContain('+added');
});

it('isolates inspector content across task switches and persists local rename and pin interactions', () => {
  dom = new JSDOM(readFileSync('src/renderer/index.html', 'utf8'), { url: 'https://workspace.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  setUiLanguage('zh-CN');
  const workspace = createWorkspace(() => {});
  const first = task('a', 'Task A'); const second = task('b', 'Task B');
  const initial = { summary: first, events: [call('recorded command A', 'run')], total: 1, state: null, working: false, waiting: false };
  workspace.update(initial);
  w.document.getElementById('detailsToggle')!.click();
  (w.document.querySelector('[data-inspector-tab="commands"]') as HTMLElement).click();
  expect(w.document.querySelector('.inspector-body')!.textContent).toContain('recorded command A');
  expect(w.document.querySelector('.inspector-body script')).toBeNull();
  workspace.update({ ...initial, summary: second, events: [] });
  expect(w.document.querySelector('.inspector-body')!.textContent).not.toContain('recorded command A');
  workspace.close();
  workspace.inspect(initial.events[0] as Extract<SessionEvent, { kind: 'tool_call' }>);
  expect(w.document.getElementById('taskInspector')!.hidden).toBe(true);
  workspace.update(initial);
  w.document.getElementById('detailsToggle')!.click();
  expect(w.document.querySelector('[data-inspector-tab="commands"]')!.getAttribute('aria-pressed')).toBe('true');
  w.document.getElementById('renameTask')!.click();
  (w.document.getElementById('localTaskName') as HTMLInputElement).value = '本地名称';
  w.document.querySelector('.task-rename form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  workspace.pin('a');
  expect(w.document.getElementById('chatTitle')!.textContent).toBe('本地名称');
  expect(readPresentation(w.localStorage).pins).toEqual(['a']);
  expect(first.title).toBe('Task A');
  w.document.getElementById('sidebarToggle')!.click();
  expect(w.document.querySelector('.app')!.classList.contains('sidebar-collapsed')).toBe(true);
  expect(JSON.parse(w.localStorage.getItem('workspace-shell-v1')!).collapsed).toBe(true);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  expect(w.document.activeElement?.id).toBe('taskSearch');
  expect(JSON.parse(w.localStorage.getItem('workspace-shell-v1')!).collapsed).toBe(false);
  const separator = w.document.querySelector('.sidebar-resize')!;
  separator.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  separator.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(separator.getAttribute('aria-valuenow')).toBe('360');
  expect(JSON.parse(w.localStorage.getItem('workspace-shell-v1')!).width).toBe(360);
});
