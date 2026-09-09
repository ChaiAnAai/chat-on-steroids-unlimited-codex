import { LANGUAGE_CODES, LANGUAGE_NAMES, type LanguageCode } from '../shared/languages.js';
import { translate, uiLanguage } from './i18n.js';

let selected: LanguageCode = 'en';
let dialog: HTMLDialogElement | undefined;
export function paintLanguagePicker(language: LanguageCode) {
  selected = language;
  if (!dialog) return;
  dialog.querySelector('h2')!.textContent = translate('Language');
  dialog.querySelector<HTMLButtonElement>('.language-close')!.textContent = translate('Done');
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-language]')) button.setAttribute('aria-checked', String(button.dataset.language === language));
}
export function initLanguagePicker(save: (language: LanguageCode) => Promise<void>) {
  dialog = document.createElement('dialog'); dialog.className = 'language-dialog'; dialog.id = 'languageDialog'; dialog.setAttribute('aria-labelledby', 'languageTitle');
  const title = document.createElement('h2'); title.id = 'languageTitle'; dialog.append(title);
  const list = document.createElement('div'); list.setAttribute('role', 'menu');
  for (const language of LANGUAGE_CODES) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.language = language; button.lang = language;
    button.textContent = LANGUAGE_NAMES[language]; button.setAttribute('role', 'menuitemradio');
    button.addEventListener('click', () => { void save(language); dialog!.close(); }); list.append(button);
  }
  list.addEventListener('keydown', event => {
    const buttons = [...list.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]!.focus(); }
  });
  const close = document.createElement('button'); close.className = 'language-close'; close.type = 'button'; close.addEventListener('click', () => dialog!.close());
  dialog.append(list, close); document.body.append(dialog);
  document.getElementById('languageBtn')!.addEventListener('click', () => {
    // The picker is created before the asynchronous initial state arrives. Read the current
    // renderer preference when opening so a saved non-English locale is never shown as English.
    selected = uiLanguage();
    paintLanguagePicker(selected); dialog!.showModal(); dialog!.querySelector<HTMLButtonElement>(`[data-language="${selected}"]`)!.focus();
  });
  dialog.addEventListener('close', () => document.querySelector<HTMLElement>('#appearanceMenu > summary')?.focus());
}
