import type { AppState } from '../shared/types.js';
import { translate } from './i18n.js';

/** Explain the first unresolved connection boundary from observed state only. */
export function browserConnectionGuide(state: AppState): string {
  const bridge = state.bridge;
  if (bridge.startupIssue === 'ports-unavailable') return translate('Browser ports are unavailable. Close another copy of this local edition, then restart. Do not stop unrelated programs.');
  if (bridge.startupIssue === 'recovery-failed') return translate('Browser service could not restore its saved state. Check Activity before restarting; your recordings are retained.');
  if (!bridge.running) return translate('Browser service is stopped. Enable session recording or sub-agents to start it.');
  if (!bridge.paired) return translate('Load the companion from this app using Open extension folder, then open a ChatGPT tab. An extension from another edition will not connect here.');
  if (!bridge.present) return translate('The browser was paired but is now offline. Open ChatGPT in the browser with this local companion enabled, then refresh.');
  return translate('Browser connected to this app. Model availability and tool access are checked separately.');
}
