import { translate } from './i18n.js';

/** Reuse the existing command buttons and their authority checks; only presentation changes. */
export function taskMenu(row: HTMLElement, actions: HTMLElement): void {
  const menu = document.createElement('details'); menu.className = 'task-menu';
  const trigger = document.createElement('summary'); trigger.textContent = '⋯'; trigger.setAttribute('aria-label', translate('Task actions')); trigger.setAttribute('aria-haspopup', 'menu');
  const list = document.createElement('div'); list.className = 'task-menu-list'; list.setAttribute('role', 'menu');
  for (const button of [...actions.querySelectorAll<HTMLButtonElement>('button')]) {
    button.title = translate(button.title); button.setAttribute('role', 'menuitem');
    const label = document.createElement('span'); label.textContent = button.title; button.append(label);
    button.addEventListener('click', () => { menu.open = false; if (trigger.isConnected) trigger.focus(); }); list.append(button);
  }
  menu.append(trigger, list); actions.append(menu);
  trigger.setAttribute('aria-expanded', 'false');
  // Let Tab move naturally, then dismiss once focus has actually left the menu.
  menu.addEventListener('focusout', event => {
    if (!(event.relatedTarget instanceof Node) || !menu.contains(event.relatedTarget)) menu.open = false;
  });
  trigger.addEventListener('click', event => event.stopPropagation());
  function open() {
    document.getElementById('sessionTooltip')?.remove();
    for (const other of document.querySelectorAll<HTMLDetailsElement>('.task-menu[open]')) if (other !== menu) other.open = false;
    const bounds = trigger.getBoundingClientRect();
    list.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 288))}px`;
    list.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - list.scrollHeight - 8))}px`;
  }
  menu.addEventListener('toggle', () => { trigger.setAttribute('aria-expanded', String(menu.open)); if (menu.open) open(); });
  menu.addEventListener('keydown', event => {
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.open = false; trigger.focus(); return; }
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); event.stopPropagation(); menu.open = true; open(); buttons[next]?.focus(); }
  });
  row.addEventListener('contextmenu', event => { event.preventDefault(); menu.open = true; open(); list.querySelector('button')?.focus(); });
}

export function initTaskMenus(): void {
  const close = (target?: EventTarget | null) => {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>('.task-menu[open]')) if (!(target instanceof Node) || !menu.contains(target)) menu.open = false;
  };
  document.addEventListener('pointerdown', event => close(event.target));
  document.addEventListener('scroll', event => { if (!(event.target instanceof Element) || !event.target.closest('.task-menu-list')) close(); }, true);
  window.addEventListener('resize', () => close());
}
