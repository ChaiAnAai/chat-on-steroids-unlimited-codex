import { ui, t } from './i18n.js';
import type { AgentPlan, AgentPlanHistoryEntry } from '../shared/agent-plan.js';
import { el, icon } from './dom.js';

/** One current plan above the composer queue; every model string is text, never HTML. */
export function renderAgentPlan(host: HTMLElement, sessionId: string | null, plan: AgentPlan | null, history: readonly AgentPlanHistoryEntry[] = []): void {
  if (host.dataset.sessionId !== (sessionId ?? '')) {
    host.replaceChildren();
    host.dataset.sessionId = sessionId ?? '';
    delete host.dataset.signature;
  }
  if (!sessionId || (!plan?.plan.length && !history.length)) {
    host.hidden = true;
    host.replaceChildren();
    delete host.dataset.signature;
    return;
  }
  const signature = JSON.stringify([plan, history]);
  if (host.dataset.signature === signature) return;
  const previous = host.querySelector<HTMLDetailsElement>('.agent-plan-shell');
  const expanded = new Map([...host.querySelectorAll<HTMLDetailsElement>('[data-step]')].map(row => [row.dataset.step, row.open]));
  const active = host.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const focused = active?.closest<HTMLElement>('[data-step]')?.dataset.step;
  const focusedRevision = active?.closest<HTMLElement>('[data-revision]')?.dataset.revision;
  const focusHeading = active?.classList.contains('agent-plan-heading');
  const focusHistory = active?.parentElement?.classList.contains('agent-plan-history');
  const steps = plan?.plan ?? [];
  const completed = steps.filter(step => step.status === 'completed').length;
  const complete = completed === steps.length;
  // Completion collapses the document but never removes the user's plan or its history.
  const justCompleted = complete && previous?.dataset.complete === 'false';
  const historyOpen = host.querySelector<HTMLDetailsElement>('.agent-plan-history')?.open ?? false;
  const expandedHistory = new Set([...host.querySelectorAll<HTMLDetailsElement>('[data-revision]')].filter(row => row.open).map(row => row.dataset.revision));
  host.hidden = false;
  const shell = el('details', 'agent-plan-shell') as HTMLDetailsElement;
  shell.dataset.complete = String(complete);
  shell.open = justCompleted ? false : previous?.open ?? !complete;
  const heading = el('summary', 'agent-plan-heading');
  heading.append(icon('i-steps'), el('span', 'agent-plan-title', () => !steps.length ? t('Plan history') : complete ? t("Plan complete") : t("Plan")),
    el('span', 'agent-plan-count', `${completed} / ${steps.length}`));
  shell.append(heading);
  const body = el('div', 'agent-plan-body');
  if (plan?.explanation) body.append(el('p', 'agent-plan-explanation', plan.explanation));
  for (const [index, step] of steps.entries()) {
    const row = el('details', 'agent-plan-step') as HTMLDetailsElement;
    row.dataset.step = step.step;
    row.dataset.status = step.status;
    row.open = expanded.get(step.step) ?? false;
    const summary = el('summary', 'agent-plan-step-heading');
    const marker = el('span', 'agent-plan-marker', step.status === 'completed' ? '✓' : String(index + 1));
    ui(marker, 'aria-label', () => step.status === 'in_progress' ? t("In progress") : step.status === 'completed' ? t("Completed") : t("Pending"));
    summary.append(marker, el('span', 'agent-plan-step-title', step.step));
    if (!step.details) summary.addEventListener('click', event => event.preventDefault());
    row.append(summary);
    if (step.details) row.append(el('div', 'agent-plan-details', step.details));
    body.append(row);
    if (focused === step.step) queueMicrotask(() => {
      if (row.isConnected && (document.activeElement === document.body || document.activeElement === active)) (shell.open ? summary : heading).focus();
    });
  }
  if (history.length) {
    const revisions = el('details', 'agent-plan-history') as HTMLDetailsElement;
    revisions.open = historyOpen;
    const historyHeading = el('summary', 'agent-plan-step-heading', () => t('Plan history ({0})', [history.length]));
    revisions.append(historyHeading);
    if (focusHistory) queueMicrotask(() => {
      if (revisions.isConnected && document.activeElement === document.body) (shell.open ? historyHeading : heading).focus();
    });
    for (const revision of [...history].sort((a, b) => b.revision - a.revision)) {
      const row = el('details', 'agent-plan-revision') as HTMLDetailsElement;
      row.dataset.revision = String(revision.revision);
      row.open = expandedHistory.has(row.dataset.revision);
      const revisionHeading = el('summary', 'agent-plan-step-heading', () => t('Revision {0}', [revision.revision]));
      row.append(revisionHeading);
      if (focusedRevision === row.dataset.revision) queueMicrotask(() => {
        if (row.isConnected && document.activeElement === document.body) (shell.open ? revisionHeading : heading).focus();
      });
      const content = el('div', 'agent-plan-details');
      if (revision.explanation) content.append(el('p', '', revision.explanation));
      if (!revision.plan.length) content.append(el('p', '', () => t('Plan cleared')));
      const list = el('ol');
      for (const step of revision.plan) {
        const item = el('li');
        item.append(el('span', '', step.step), el('span', 'meta', () => ` · ${step.status === 'completed' ? t('Completed') : step.status === 'in_progress' ? t('In progress') : t('Pending')}`));
        if (step.details) item.append(el('p', '', step.details));
        list.append(item);
      }
      content.append(list); row.append(content); revisions.append(row);
    }
    body.append(revisions);
  }
  shell.append(body);
  host.replaceChildren(shell);
  host.dataset.signature = signature;
  if (focusHeading) heading.focus();
}
