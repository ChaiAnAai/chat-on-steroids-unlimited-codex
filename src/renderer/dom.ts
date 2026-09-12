import { t, ui } from './i18n.js';
/**
 * The handful of DOM helpers both panels need.
 *
 * Nothing here knows about app state, and nothing here uses innerHTML — every node is
 * built from text, so a session title or a tool argument can never become markup.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One icon from the sprite in index.html. */
export function icon(name: string, className = 'ico'): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

export function el(tag: string, className = '', text: string | (() => string) = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof text === 'function') ui(node, 'textContent', text);
  else if (text) node.textContent = text;
  return node;
}

export const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Filter complete settings sections so headings, controls and their context stay together. */
export function filterSettingsSections(view: HTMLElement, search: string): void {
  const query = search.trim().toLowerCase();
  let matches = 0;
  for (const heading of view.querySelectorAll<HTMLElement>('.settings-section-title')) {
    const pane = heading.nextElementSibling as HTMLElement | null;
    if (!pane?.classList.contains('pane')) continue;
    const visible = !query || `${heading.textContent} ${pane.textContent}`.toLowerCase().includes(query);
    heading.hidden = pane.hidden = !visible;
    if (visible) matches++;
  }
  const empty = view.querySelector<HTMLElement>('#settingsSearchEmpty');
  if (empty) empty.hidden = !query || matches > 0;
}

export interface FeedbackOptions {
  host?: HTMLElement;
  current?: () => boolean;
  retry?: () => void;
  operation?: string;
}
export function feedback(host: HTMLElement, message: string, tone: 'busy' | 'success' | 'error', retry?: () => void): void {
  host.hidden = false; host.classList.add('operation-feedback'); host.dataset.tone = tone;
  host.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  host.setAttribute('aria-busy', String(tone === 'busy'));
  host.replaceChildren(el('span', '', message));
  if (retry) {
    const button = el('button', 'btn', () => t('Retry')) as HTMLButtonElement;
    button.type = 'button'; button.onclick = retry; host.append(button);
  }
}
export function toast(message: string, tone: 'success' | 'error' = 'success'): void {
  let stack = document.getElementById('notificationStack');
  if (!stack) { stack = el('section', 'notification-stack'); stack.id = 'notificationStack'; document.body.append(stack); }
  const node = el('div', 'toast'); feedback(node, message, tone);
  const close = el('button', 'btn', '×') as HTMLButtonElement;
  close.type = 'button'; ui(close, 'aria-label', () => t('Dismiss notification'));
  close.onclick = () => node.remove(); node.append(close); stack.append(node);
  if (tone !== 'error') window.setTimeout(() => node.remove(), 5000);
}
/** IPC receipt unwrapping with operation-local, persistent failure feedback. */
export async function run<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>, options: FeedbackOptions = {}
): Promise<T | null> {
  const scope = options.host ?? document.activeElement?.closest<HTMLElement>('.plugin-dialog-body, .plugin-card, .setting, form, .appearance-section');
  const report = (message: string) => {
    if (options.current && !options.current()) return;
    if (scope?.isConnected) {
      let host = [...scope.querySelectorAll<HTMLElement>(':scope > .operation-feedback')].find(node => node.dataset.operation === options.operation);
      if (!host) { host = el('div', 'operation-feedback'); scope.append(host); }
      if (options.operation) host.dataset.operation = options.operation;
      feedback(host, message, 'error', options.retry);
    } else toast(message, 'error');
  };
  try {
    const reply = await promise;
    if (!reply.ok) { report(reply.error); return null; }
    if (options.operation && (!options.current || options.current())) {
      for (const node of scope?.querySelectorAll<HTMLElement>(':scope > .operation-feedback') ?? [])
        if (node.dataset.operation === options.operation) node.remove();
    }
    return reply.data;
  } catch (error) {
    report(error instanceof Error ? error.message : t('Operation failed. Please try again.'));
    return null;
  }
}

/** "12s ago" for a timestamp the main process vouched for, "never" for null. */
export function ago(atMs: number | null): string {
  if (atMs === null) return t("never");
  const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
  if (seconds < 3) return t("just now");
  if (seconds < 90) return t("{0}s ago", [seconds]);
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? t("{0}m ago", [minutes]) : t("{0}h ago", [Math.round(minutes / 60)]);
}

/** The same age as one glanceable token: "8s", "2m", "—" when there is nothing. */
export function shortAgo(atMs: number | null): string {
  if (atMs === null) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
  if (seconds < 3) return t("now");
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/** A clock time for one event in a timeline. */
export function clockTime(atMs: number): string {
  return new Date(atMs).toLocaleTimeString();
}

/** "1.2k", "3.4M" — for token and character counts that get large. */
export function compactNumber(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
