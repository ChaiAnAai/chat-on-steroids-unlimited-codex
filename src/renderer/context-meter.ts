import type { Config } from '../shared/types.js';
import type { SessionSummary } from '../shared/session.js';
import type { ReasoningEffort } from '../shared/session.js';
import { isProModel } from '../shared/chat-models.js';
import { ui, translate } from './i18n.js';

/** Recorder estimates, never a claim about the provider's exact context window. */
export function paintContextMeter(session: SessionSummary | null, config: Config, composer: { model: string; reasoningEffort: ReasoningEffort } | null = null): void {
  const button = document.getElementById('contextMeterButton');
  const panel = document.getElementById('contextMeterInfo');
  const arc = document.getElementById('contextMeterArc');
  if (!button || !panel || !arc) return;
  const used = Math.max(0, session?.contextTokens ?? 0);
  // The picker owns the next send choice; the recording may still describe the
  // preceding turn (or not exist yet in a new chat).
  const observed = session?.selectedModel;
  const selection = composer ?? (observed?.conversationId === session?.conversationId ? observed : null);
  const pro = isProModel(selection?.model, selection?.reasoningEffort);
  const limit = config.sessions.limitTokens;
  const percent = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
  arc.setAttribute('stroke-dasharray', `${pro ? 0 : percent * 0.377} 37.7`);
  const tokens = new Intl.NumberFormat().format(used);
  const copy = ui();
  panel.textContent = pro
    ? `${copy.sessionContextEstimated}\n${translate('{tokens} tokens used', { tokens })}\n${translate('Auto-compaction off for Pro')}`
    : `${copy.sessionContextEstimated}\n${translate('{tokens} / {limit} tokens · {percent}% of configured limit', { tokens, limit: new Intl.NumberFormat().format(limit), percent })}\n${config.compaction.auto ? translate('Auto-compaction at {tokens} tokens', { tokens: new Intl.NumberFormat().format(config.compaction.autoTokens) }) : copy.autoCompactOff}`;
  button.setAttribute('aria-label', panel.textContent.replaceAll('\n', '. '));
}

export function initContextMeter(): void {
  const root = document.getElementById('contextMeter');
  const button = document.getElementById('contextMeterButton');
  if (!root || !button) return;
  const close = () => { root.classList.remove('pinned'); button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', () => { const open = root.classList.toggle('pinned'); button.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', event => { if (event.target instanceof Node && !root.contains(event.target)) close(); });
  button.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.blur(); } });
}
