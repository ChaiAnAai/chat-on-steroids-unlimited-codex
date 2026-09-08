import { translate, uiLanguage } from './i18n.js';

/** Only app-authored markup is marked for translation. Chat text, drafts, paths and
 * model/tool identifiers never enter this translation pass. */
export function translateMarkup(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = translate(node.dataset.i18n!);
  }
  for (const attribute of ['title', 'placeholder', 'aria-label'] as const) {
    for (const node of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      node.setAttribute(attribute, translate(node.getAttribute(`data-i18n-${attribute}`)!));
    }
  }
  document.documentElement.lang = uiLanguage();
}
