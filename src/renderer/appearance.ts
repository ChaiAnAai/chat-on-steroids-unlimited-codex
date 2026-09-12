import { DEFAULT_APPEARANCE, resolvedTheme, type Appearance, type ThemeMode } from '../shared/appearance.js';
import { $, el } from './dom.js';
import { t, ui } from './i18n.js';

/** Persisted settings stay in main. This is only the current visual preview. */
export function initAppearance(save: (value: { theme: ThemeMode; appearance: Appearance }) => void) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let mode: ThemeMode = 'dark', appearance = { ...DEFAULT_APPEARANCE };
  const paint = () => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme(mode, media?.matches ?? false);
    root.dataset.accent = appearance.accent;
    root.dataset.density = appearance.density;
    root.style.setProperty('--ui-size', `${appearance.interfaceSize}px`);
    root.style.setProperty('--code-size', `${appearance.codeSize}px`);
    $('themeIcon').setAttribute('href', root.dataset.theme === 'dark' ? '#i-moon' : '#i-sun');
    ui($('themeBtn'), 'title', () => t('Appearance'));
    ui($('themeBtn'), 'aria-label', () => t('Appearance'));
    for (const button of document.querySelectorAll<HTMLElement>('[data-theme-choice]'))
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === mode));
    for (const button of document.querySelectorAll<HTMLElement>('[data-accent-choice]'))
      button.setAttribute('aria-pressed', String(button.dataset.accentChoice === appearance.accent));
    ($('interfaceSize') as HTMLSelectElement).value = String(appearance.interfaceSize);
    ($('codeSize') as HTMLSelectElement).value = String(appearance.codeSize);
    ($('appearanceDensity') as HTMLSelectElement).value = appearance.density;
  };
  const changed = () => { paint(); save({ theme: mode, appearance: { ...appearance } }); };
  document.querySelectorAll<HTMLElement>('[data-theme-choice]').forEach(button => {
    button.onclick = () => { mode = button.dataset.themeChoice as ThemeMode; changed(); };
  });
  document.querySelectorAll<HTMLElement>('[data-accent-choice]').forEach(button => {
    button.onclick = () => { appearance.accent = button.dataset.accentChoice as Appearance['accent']; changed(); };
  });
  $('interfaceSize').onchange = () => { appearance.interfaceSize = Number(($('interfaceSize') as HTMLSelectElement).value) as Appearance['interfaceSize']; changed(); };
  $('codeSize').onchange = () => { appearance.codeSize = Number(($('codeSize') as HTMLSelectElement).value) as Appearance['codeSize']; changed(); };
  $('appearanceDensity').onchange = () => { appearance.density = ($('appearanceDensity') as HTMLSelectElement).value as Appearance['density']; changed(); };
  $('resetAppearance').onclick = () => { mode = 'dark'; appearance = { ...DEFAULT_APPEARANCE }; changed(); };
  media?.addEventListener('change', paint);
  // Preview uses the same actual component tokens as the rest of the workspace.
  const preview = $('appearancePreview');
  preview.append(el('span', 'preview-eyebrow', () => t('Live preview')), el('h2', '', () => t('A clear space for your next idea.')),
    el('p', 'muted', () => t('Your conversations, tools and progress — in one workspace.')),
    el('pre', '', 'const next = await explore(idea);'), el('button', 'btn btn-solid', () => t('Continue')));
  (preview.querySelector('button') as HTMLButtonElement).type = 'button';
  (preview.querySelector('button') as HTMLButtonElement).disabled = true;
  return { apply(theme: ThemeMode, prefs?: Appearance) { mode = theme; appearance = { ...DEFAULT_APPEARANCE, ...prefs }; paint(); } };
}
