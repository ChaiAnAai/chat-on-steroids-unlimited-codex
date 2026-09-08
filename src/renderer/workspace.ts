import { translate } from './i18n.js';
import { browserConnectionGuide } from './connection-guide.js';
import type { AppState } from '../shared/types.js';
import type { LocalProject } from '../shared/projects.js';
import type { SessionEvent, SessionSummary } from '../shared/session.js';

type ToolEvent = Extract<SessionEvent, { kind: 'tool_call' }>;
type InspectorTab = 'changes' | 'commands' | 'connection';
const STORAGE_KEY = 'workspace-presentation-v1';
interface Presentation { names: Record<string, string>; pins: string[]; collapsed: string[] }
const emptyPresentation = (): Presentation => ({ names: {}, pins: [], collapsed: [] });

/** Local labels and pins never rename provider conversations or alter recorded evidence. */
export function readPresentation(storage?: Pick<Storage, 'getItem'>): Presentation {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return emptyPresentation();
    const ids = (source: unknown) => Array.isArray(source) ? source.filter((v): v is string => typeof v === 'string').slice(-1000) : [];
    const names = Object.fromEntries(Object.entries(value.names ?? {}).filter(([id, name]) => id.length < 256 && typeof name === 'string' && name.length <= 120));
    return { names: names as Record<string, string>, pins: ids(value.pins), collapsed: ids(value.collapsed) };
  } catch { return emptyPresentation(); }
}
export function taskLabel(summary: SessionSummary, presentation: Presentation): string {
  return presentation.names[summary.id] || summary.title || translate('Untitled session');
}
export function taskMatches(summary: SessionSummary, project: LocalProject | undefined, query: string, presentation: Presentation): boolean {
  const text = `${taskLabel(summary, presentation)} ${summary.title} ${project?.name ?? ''} ${project?.path ?? ''}`.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word));
}
export function recordedTools(events: SessionEvent[], tab: InspectorTab): ToolEvent[] {
  return events.filter((event): event is ToolEvent => event.kind === 'tool_call' && (tab === 'commands'
    ? ['run', 'process'].includes(event.call.summary.kind)
    : (event.call.changes?.length ?? 0) > 0 || ['edit', 'create', 'delete', 'move'].includes(event.call.summary.kind)));
}
export function recordedPatch(text: string): string | null {
  const isPatch = (value: unknown): value is string => typeof value === 'string' && /^(\*\*\* Begin Patch|diff --git |--- [^\n]+\n\+\+\+ )/.test(value.trimStart());
  if (isPatch(text)) return text;
  try { const args = JSON.parse(text); return [args.patch, args.patch_text, args.input].find(isPatch) ?? null; } catch { return null; }
}
export function taskPhase(summary: SessionSummary | null, working: boolean, waiting: boolean): string {
  if (waiting) return 'Waiting for you';
  if (working) return 'Running';
  if (!summary) return 'New task';
  if (summary.lastTurnOutcome === 'completed') return 'Completed';
  if (summary.lastTurnOutcome === 'failed') return 'Failed';
  if (summary.lastTurnOutcome) return 'Stopped';
  return 'Ready';
}

interface Snapshot {
  summary: SessionSummary | null; project?: LocalProject; events: SessionEvent[];
  total: number; state: AppState | null; working: boolean; waiting: boolean;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
};
const button = (text: string, action: () => void, className = 'btn') => {
  const element = node('button', className, translate(text)); element.type = 'button'; element.addEventListener('click', action); return element;
};

export function createWorkspace(onLabelsChanged: () => void) {
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Presentation still works for this window. */ }
  const presentation = readPresentation(storage);
  const save = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(presentation)); } catch { /* Optional presentation storage. */ } };
  const app = document.querySelector<HTMLElement>('.app')!;
  // Shell preferences are independent of per-task labels and the main-process language setting.
  let shell: { width: number; collapsed: boolean } = { width: 244, collapsed: false };
  try {
    const saved = JSON.parse(storage?.getItem('workspace-shell-v1') ?? 'null');
    if (saved) shell = { width: Number.isFinite(saved.width) ? Math.max(200, Math.min(360, saved.width)) : 244, collapsed: saved.collapsed === true };
  } catch { /* Use accessible defaults when optional local storage is unavailable. */ }
  const sidebarToggle = document.getElementById('sidebarToggle')!;
  const resize = node('div', 'sidebar-resize');
  resize.tabIndex = 0; resize.setAttribute('role', 'separator'); resize.setAttribute('aria-orientation', 'vertical');
  resize.setAttribute('aria-valuemin', '200'); resize.setAttribute('aria-valuemax', '360');
  resize.setAttribute('aria-label', translate('Resize sidebar'));
  document.querySelector('.sidebar')!.append(resize);
  function applyShell() {
    app.style.setProperty('--sidebar-width', `${shell.width}px`);
    app.classList.toggle('sidebar-collapsed', shell.collapsed);
    document.querySelector<HTMLElement>('.sidebar')!.inert = app.dataset.screen === 'chat' && shell.collapsed;
    sidebarToggle.setAttribute('aria-expanded', String(!shell.collapsed));
    resize.setAttribute('aria-valuenow', String(shell.width));
  }
  function saveShell() { try { storage?.setItem('workspace-shell-v1', JSON.stringify(shell)); } catch { /* Optional. */ } }
  function expandSidebar(collapsed: boolean) { shell.collapsed = collapsed; applyShell(); saveShell(); }
  applyShell();
  let drag: { x: number; width: number } | null = null;
  resize.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    app.classList.add('is-resizing');
    drag = { x: event.clientX, width: shell.width }; resize.setPointerCapture(event.pointerId); event.preventDefault();
  });
  resize.addEventListener('pointermove', event => {
    if (!drag) return;
    shell.width = Math.round(Math.max(200, Math.min(360, drag.width + event.clientX - drag.x))); applyShell();
  });
  resize.addEventListener('lostpointercapture', () => { drag = null; app.classList.remove('is-resizing'); saveShell(); });
  resize.addEventListener('dblclick', () => { shell.width = 244; applyShell(); saveShell(); });
  resize.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    shell.width = event.key === 'Home' ? 200 : event.key === 'End' ? 360 : Math.max(200, Math.min(360, shell.width + (event.key === 'ArrowLeft' ? -10 : 10)));
    applyShell(); saveShell();
  });
  const host = document.querySelector<HTMLElement>('[data-panel="chat"]')!;
  const toggle = document.getElementById('detailsToggle')!;
  const panel = node('aside', 'task-inspector'); panel.id = 'taskInspector'; panel.hidden = true;
  panel.setAttribute('aria-label', translate('Task details'));
  const heading = node('div', 'inspector-heading');
  const title = node('strong', '', translate('Task details'));
  const close = button('Close details', () => { setOpen(false); toggle.focus(); });
  heading.append(title, close);
  const tabs = node('div', 'inspector-tabs');
  const body = node('div', 'inspector-body'); body.tabIndex = -1;
  panel.append(heading, tabs, body); host.append(panel);
  let snapshot: Snapshot | null = null;
  let tab: InspectorTab = 'changes';
  let selectedCall: string | null = null;
  let signature = '';
  const views = new Map<string, { tab: InspectorTab; call: string | null; scroll: number }>();
  const captions: Record<InspectorTab, string> = { changes: 'Changes', commands: 'Commands', connection: 'Connection' };
  for (const kind of Object.keys(captions) as InspectorTab[]) {
    const control = button(captions[kind], () => { tab = kind; selectedCall = null; paint(); });
    control.dataset.inspectorTab = kind; tabs.append(control);
  }
  function setOpen(open: boolean) {
    if (open && document.getElementById('agentPanelToggle')?.getAttribute('aria-expanded') === 'true') document.getElementById('agentPanelToggle')?.click();
    panel.hidden = !open; host.classList.toggle('has-inspector', open); toggle.setAttribute('aria-expanded', String(open));
    panel.inert = !open;
    if (open) paint();
  }
  toggle.addEventListener('click', () => { setOpen(panel.hidden !== false); if (!panel.hidden) body.focus(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !event.shiftKey && !event.altKey && app.dataset.screen === 'chat' && !document.querySelector('dialog[open]')) {
      event.preventDefault(); document.getElementById('newChat')!.click(); document.getElementById('chatInput')!.focus();
    }
    if (event.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) { setOpen(false); toggle.focus(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && app.dataset.screen === 'chat') {
      event.preventDefault(); expandSidebar(false);
      document.getElementById('taskSearch')!.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && !event.shiftKey && !event.altKey && app.dataset.screen === 'chat' && !document.querySelector('dialog[open]')) {
      event.preventDefault(); expandSidebar(!shell.collapsed); sidebarToggle.focus();
    }
  });
  document.getElementById('connectionHelp')!.addEventListener('click', () => { tab = 'connection'; setOpen(true); body.focus(); });
  sidebarToggle.addEventListener('click', () => expandSidebar(!shell.collapsed));

  const dialog = document.createElement('dialog'); dialog.className = 'task-rename';
  const form = node('form', ''); form.method = 'dialog';
  const label = node('label', '', translate('Local task name')); label.htmlFor = 'localTaskName';
  const input = node('input', ''); input.id = 'localTaskName'; input.maxLength = 120; input.required = true;
  const hint = node('p', 'muted', translate('Only the name in this app changes. Recorded content is kept.'));
  const actions = node('div', 'rename-actions');
  const cancel = button('Cancel', () => dialog.close());
  const submit = node('button', 'btn', translate('Save')); submit.type = 'submit';
  actions.append(cancel, submit); form.append(label, input, hint, actions); dialog.append(form); document.body.append(dialog);
  let renaming: string | null = null;
  document.getElementById('renameTask')!.addEventListener('click', () => {
    if (!snapshot?.summary) return;
    renaming = snapshot.summary.id; input.value = taskLabel(snapshot.summary, presentation);
    label.textContent = translate('Local task name'); hint.textContent = translate('Only the name in this app changes. Recorded content is kept.');
    cancel.textContent = translate('Cancel'); submit.textContent = translate('Save');
    dialog.showModal(); input.select();
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!renaming || !input.value.trim()) return;
    presentation.names[renaming] = input.value.trim(); save(); dialog.close(); onLabelsChanged();
    if (snapshot) update(snapshot);
  });

  function paint() {
    if (!snapshot || panel.hidden) return;
    title.textContent = translate('Task details'); close.textContent = translate('Close details');
    for (const control of tabs.querySelectorAll<HTMLButtonElement>('button')) {
      control.textContent = translate(captions[control.dataset.inspectorTab as InspectorTab]);
      control.setAttribute('aria-pressed', String(control.dataset.inspectorTab === tab));
    }
    const calls = recordedTools(snapshot.events, tab);
    const nextSignature = JSON.stringify([snapshot.summary?.id, tab, selectedCall, calls, tab === 'connection' && snapshot.state ? browserConnectionGuide(snapshot.state) : null, translate('Changes'), snapshot.total]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const scroll = body.scrollTop;
    body.replaceChildren();
    if (tab === 'connection') {
      body.append(node('h3', '', translate(snapshot.state?.bridge.present ? 'Browser connected' : 'Browser not connected')));
      if (snapshot.state) body.append(node('p', 'inspector-note', browserConnectionGuide(snapshot.state)));
      body.append(button('Open connection settings', () => { document.getElementById('workspaceSettings')?.click(); document.querySelector<HTMLButtonElement>('[data-tab="setup"]')?.click(); }));
      return;
    }
    body.append(node('p', 'inspector-note', translate('Recorded activity from the loaded conversation page. This is not a live Git diff or terminal.')));
    if (!calls.length) { body.append(node('p', 'inspector-empty', translate(snapshot.summary ? 'No matching activity in this page.' : 'Select a task to inspect its recorded activity.'))); return; }
    const active = calls.find(event => event.call.callId === selectedCall) ?? calls[calls.length - 1]!;
    const choices = node('div', 'inspector-calls');
    for (const event of calls.slice(-80).reverse()) {
      const choice = button(event.call.summary.title, () => { selectedCall = event.call.callId; paint(); }, 'inspector-call');
      // Evidence titles are authored by the recorder, never translated as interface copy.
      choice.textContent = event.call.summary.title;
      choice.setAttribute('aria-pressed', String(event === active));
      choice.append(node('small', event.call.outcome === 'ok' ? '' : 'is-bad', `${event.call.tool} · ${event.call.outcome} · ${Math.round(event.call.durationMs)} ms`));
      choices.append(choice);
    }
    body.append(choices);
    for (const change of active.call.changes ?? []) body.append(node('div', 'inspector-file', `${change.path}  ${change.approximate ? '≈ ' : ''}+${change.added} −${change.removed}`));
    const patch = recordedPatch(active.call.args.text);
    if (patch) {
      body.append(node('h3', '', translate('Recorded patch')));
      const pre = node('pre', 'inspector-code recorded-patch');
      for (const line of patch.slice(0, 64000).split('\n')) pre.append(node('span', line.startsWith('+') ? 'patch-add' : line.startsWith('-') ? 'patch-remove' : '', `${line}\n`));
      body.append(pre);
    }
    for (const [caption, content] of [['Arguments', active.call.args], ['Result', active.call.result]] as const) {
      body.append(node('h3', '', translate(caption)));
      const pre = node('pre', 'inspector-code', content.text.slice(0, 64000));
      body.append(pre);
      if (content.truncated || content.text.length > 64000) body.append(node('p', 'inspector-note', translate('Preview truncated; the recorded source may contain more content.')));
    }
    body.scrollTop = scroll;
  }
  function update(next: Snapshot) {
    resize.setAttribute('aria-label', translate('Resize sidebar'));
    if (next.summary?.id !== snapshot?.summary?.id) {
      if (snapshot?.summary) views.set(snapshot.summary.id, { tab, call: selectedCall, scroll: body.scrollTop });
      const previous = next.summary ? views.get(next.summary.id) : undefined;
      tab = previous?.tab ?? 'changes'; selectedCall = previous?.call ?? null; signature = '';
      snapshot = next; paint(); body.scrollTop = previous?.scroll ?? 0;
    } else snapshot = next;
    const project = document.getElementById('taskProject')!;
    project.textContent = next.project?.name ?? translate('Workspace'); project.title = next.project?.path ?? '';
    document.getElementById('chatTitle')!.textContent = next.summary ? taskLabel(next.summary, presentation) : translate('New task');
    const phase = taskPhase(next.summary, next.working, next.waiting);
    const status = document.getElementById('taskStatus')!; status.textContent = translate(phase); status.dataset.phase = phase;
    status.hidden = !next.summary;
    document.getElementById('renameTask')!.hidden = !next.summary;
    document.getElementById('welcomeContext')!.textContent = next.project ? translate('Your task will use the selected project.') : translate('Choose a project, describe a task, and review the result here.');
    paint();
  }
  return {
    presentation, update, label: (summary: SessionSummary) => taskLabel(summary, presentation),
    pin(id: string) { presentation.pins = presentation.pins.includes(id) ? presentation.pins.filter(value => value !== id) : [...presentation.pins, id].slice(-1000); save(); onLabelsChanged(); },
    collapse(id: string, collapsed: boolean) { presentation.collapsed = presentation.collapsed.filter(value => value !== id); if (collapsed) presentation.collapsed.push(id); save(); },
    close: () => setOpen(false),
    inspect(event: ToolEvent) {
      // A detached row or a worker pane must never redirect inspection to a different task.
      if (!snapshot?.events.some(candidate => candidate.kind === 'tool_call' && candidate.call.callId === event.call.callId)) return;
      tab = ['run', 'process'].includes(event.call.summary.kind) ? 'commands' : 'changes'; selectedCall = event.call.callId; signature = ''; setOpen(true); body.focus();
    }
  };
}
