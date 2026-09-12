import { $, feedback } from './dom.js';
import { t } from './i18n.js';

/** Every action uses the same main-process resolver, which materializes the bundled files. */
export function initExtensionSetup(): void {
  const path = $<HTMLInputElement>('extensionPath');
  const notice = $('extensionSetupFeedback');
  const prepare = $<HTMLButtonElement>('bridgePrepare');
  const copy = $<HTMLButtonElement>('bridgeCopyPath');
  const open = $<HTMLButtonElement>('bridgeFolder');
  let busy = false;
  async function perform(action: 'prepare' | 'copy' | 'open'): Promise<void> {
    if (busy) return;
    busy = true;
    for (const button of [prepare, copy, open]) button.disabled = true;
    feedback(notice, t('Preparing extension folder…'), 'busy');
    try {
      const api = window.api;
      const reply = await (action === 'copy' ? api.copyExtensionPath() : action === 'open' ? api.openExtensionFolder() : api.extensionPath());
      if (!reply.ok) throw new Error(reply.error);
      if (!reply.data) throw new Error('The bundled extension is missing. Reinstall this app version to restore it.');
      path.value = reply.data;
      feedback(notice, t(action === 'copy' ? 'Installation path copied. Paste it into the browser folder picker.' : action === 'open' ? 'Installation folder opened. Select this same folder in the browser.' : 'Extension folder ready. Browser installation and account confirmation are still required.'), 'success');
    } catch (error) {
      // A failed lookup must not keep advertising a path that no longer exists.
      path.value = '';
      feedback(notice, t(error instanceof Error ? error.message : 'Could not prepare the extension folder.'), 'error', () => { void perform(action); });
    } finally {
      busy = false;
      for (const button of [prepare, copy, open]) button.disabled = false;
    }
  }
  prepare.addEventListener('click', () => { void perform('prepare'); });
  copy.addEventListener('click', () => { void perform('copy'); });
  open.addEventListener('click', () => { void perform('open'); });
  void perform('prepare');
}
