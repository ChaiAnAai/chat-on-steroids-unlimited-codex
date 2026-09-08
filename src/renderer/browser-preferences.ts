import type { BrowserPreferences } from '../shared/browser-preferences.js';
import { $ } from './dom.js';
import { ui } from './i18n.js';

/** Values are acknowledged extension observations, never app configuration. */
export function initBrowserPreferences(): void {
  const overwrite = $<HTMLInputElement>('browserOverwrite');
  const durations = $<HTMLInputElement>('browserDurations');
  const refresh = $<HTMLButtonElement>('browserPreferencesRefresh');
  const status = $('browserPreferencesStatus');
  let confirmed: BrowserPreferences | null = null;
  let busy = false;
  const paint = (): void => {
    overwrite.disabled = durations.disabled = busy || !confirmed;
    refresh.disabled = busy;
    overwrite.checked = confirmed?.overwrite ?? false;
    durations.checked = confirmed?.durations ?? false;
  };
  const request = async (patch: Partial<BrowserPreferences> = {}): Promise<void> => {
    if (busy) return;
    busy = true; paint(); status.textContent = ui().browserExtensionWaiting;
    try {
      const response = await window.api.browserPreferences(patch);
      if (response.ok) { confirmed = response.data; status.textContent = ui().browserExtensionConfirmed; }
      else { confirmed = null; status.textContent = response.error; }
    } catch { confirmed = null; status.textContent = ui().browserExtensionUnavailable; }
    finally { busy = false; paint(); }
  };
  overwrite.addEventListener('change', () => void request({ overwrite: overwrite.checked }));
  durations.addEventListener('change', () => void request({ durations: durations.checked }));
  refresh.addEventListener('click', () => void request());
  paint();
}
