import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderAgentPlan } from '../src/renderer/agent-plan.js';
import type { AgentPlan } from '../src/shared/agent-plan.js';

let dom: JSDOM, host: HTMLElement;
const plan: AgentPlan = { updatedAt: 1, explanation: 'Verify the change', plan: [
  { step: 'Inspect the source', status: 'completed', details: 'Read the current callers.' },
  { step: 'Repair ownership', status: 'in_progress', details: '<img src=x onerror=alert(1)>\nKeep the same session.' },
  { step: 'Verify behavior', status: 'pending' }
] };
beforeEach(() => {
  dom = new JSDOM('<section id="plan"></section>'); vi.stubGlobal('document', dom.window.document); host = document.getElementById('plan')!;
  dom.window.HTMLElement.prototype.animate = vi.fn();
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });

it('shows headlines, safely expands details, and retains disclosure state across status updates', () => {
  renderAgentPlan(host, 'a', plan);
  expect(host.hidden).toBe(false);
  expect(host.querySelector('.agent-plan-count')?.textContent).toBe('1 / 3');
  expect(host.querySelector('img')).toBeNull();
  const row = host.querySelectorAll<HTMLDetailsElement>('[data-step]')[1]!;
  expect(row.open).toBe(false);
  row.open = true;
  renderAgentPlan(host, 'a', { ...plan, updatedAt: 2, plan: plan.plan.map(step => ({ ...step, status: 'completed' })) });
  expect(host.querySelectorAll<HTMLDetailsElement>('[data-step]')[1]!.open).toBe(true);
  expect(host.querySelector('.agent-plan-title')?.textContent).toBe('Plan complete');
  expect(host.querySelectorAll('.agent-plan-details')[1]?.textContent).toContain('<img src=x');
});

it('clears other chats immediately and does not inherit their expanded state', () => {
  renderAgentPlan(host, 'a', plan);
  host.querySelector<HTMLDetailsElement>('[data-step]')!.open = true;
  renderAgentPlan(host, 'b', null);
  expect(host.hidden).toBe(true);
  expect(host.childElementCount).toBe(0);
  renderAgentPlan(host, 'b', plan);
  expect(host.querySelector<HTMLDetailsElement>('[data-step]')!.open).toBe(false);
  renderAgentPlan(host, 'b', { updatedAt: 2, plan: [] });
  expect(host.hidden).toBe(true);
});

it('collapses completion and preserves the completed document through reloads', () => {
  const complete = { ...plan, updatedAt: 2, plan: plan.plan.map(step => ({ ...step, status: 'completed' as const })) };
  renderAgentPlan(host, 'a', plan);
  renderAgentPlan(host, 'a', complete);
  expect(host.hidden).toBe(false);
  renderAgentPlan(host, 'a', complete);
  expect(host.querySelector<HTMLDetailsElement>('.agent-plan-shell')!.open).toBe(false);
  expect(dom.window.HTMLElement.prototype.animate).not.toHaveBeenCalled();
  host.querySelector<HTMLDetailsElement>('.agent-plan-shell')!.open = true;
  renderAgentPlan(host, 'a', complete);
  expect(host.querySelector<HTMLDetailsElement>('.agent-plan-shell')!.open).toBe(true);
  renderAgentPlan(host, 'b', null);
  renderAgentPlan(host, 'a', complete);
  expect(host.hidden).toBe(false);
  expect(host.querySelector<HTMLDetailsElement>('.agent-plan-shell')!.open).toBe(false);
  expect(host.textContent).toContain('Verify behavior');
});

it('does not schedule a delayed dismissal that could hide a replacement plan', () => {
  renderAgentPlan(host, 'a', plan);
  renderAgentPlan(host, 'a', { ...plan, plan: plan.plan.map(step => ({ ...step, status: 'completed' })) });
  renderAgentPlan(host, 'a', { ...plan, explanation: 'New work' });
  expect(host.hidden).toBe(false);
  expect(host.textContent).toContain('New work');
  expect(dom.window.HTMLElement.prototype.animate).not.toHaveBeenCalled();
});

it('keeps plan history available after clearing the current plan and scopes disclosure to a session', () => {
  const history = [{ ...plan, revision: 1 }, { ...plan, updatedAt: 2, revision: 2, explanation: '<script>Revision</script>' }];
  renderAgentPlan(host, 'a', { updatedAt: 3, plan: [] }, history);
  expect(host.hidden).toBe(false);
  expect(host.querySelector('.agent-plan-title')?.textContent).toBe('Plan history');
  expect(host.querySelector('script')).toBeNull();
  expect([...host.querySelectorAll<HTMLElement>('[data-revision]')].map(row => row.dataset.revision)).toEqual(['2', '1']);
  host.querySelector<HTMLDetailsElement>('.agent-plan-history')!.open = true;
  host.querySelector<HTMLDetailsElement>('[data-revision="1"]')!.open = true;
  renderAgentPlan(host, 'a', plan, history);
  expect(host.querySelector<HTMLDetailsElement>('.agent-plan-history')!.open).toBe(true);
  expect(host.querySelector<HTMLDetailsElement>('[data-revision="1"]')!.open).toBe(true);
  renderAgentPlan(host, 'b', plan, history);
  expect(host.querySelector<HTMLDetailsElement>('.agent-plan-history')!.open).toBe(false);
  expect(host.querySelector<HTMLDetailsElement>('[data-revision="1"]')!.open).toBe(false);
});

it('keeps keyboard focus reachable when a focused plan completes without stealing later input focus', async () => {
  renderAgentPlan(host, 'a', plan);
  host.querySelectorAll<HTMLElement>('.agent-plan-step-heading')[1]!.focus();
  renderAgentPlan(host, 'a', { ...plan, plan: plan.plan.map(step => ({ ...step, status: 'completed' })) });
  await Promise.resolve();
  expect(document.activeElement).toBe(host.querySelector('.agent-plan-heading'));
  renderAgentPlan(host, 'a', plan);
  host.querySelector<HTMLDetailsElement>('.agent-plan-shell')!.open = true;
  host.querySelectorAll<HTMLElement>('.agent-plan-step-heading')[1]!.focus();
  renderAgentPlan(host, 'a', { ...plan, explanation: 'Updated work' });
  const input = document.createElement('input'); document.body.append(input); input.focus();
  await Promise.resolve();
  expect(document.activeElement).toBe(input);
});
