import { defaultAppearance, type Appearance } from '../shared/appearance.js';
import type { UiPrefs } from '../shared/types.js';
import { translate } from './i18n.js';

let current = defaultAppearance();
let theme: UiPrefs['theme'] = 'dark';
let dialog: HTMLDialogElement | undefined;
const fonts = { system: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif', sans: 'Arial, "Microsoft YaHei", sans-serif', serif: 'Georgia, "Microsoft YaHei", serif', mono: 'Consolas, "Microsoft YaHei", monospace' };
const codeFonts = { cascadia: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', consolas: 'Consolas, monospace', courier: '"Courier New", monospace' };

export function applyAppearance(value: Appearance) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const variables = {
    '--ui-font': fonts[value.font], '--mono': codeFonts[value.codeFont],
    '--ui-text-size': `${value.textSize}px`, '--ui-code-size': `${value.codeSize}px`,
    '--ui-accent': value.accent, '--ui-chat-width': `${value.chatWidth}px`,
    '--ui-row-height': `${{ compact: 30, comfortable: 36, spacious: 44 }[value.density]}px`,
    '--ui-message-gap': `${{ compact: 12, comfortable: 22, spacious: 32 }[value.density]}px`,
    '--ui-radius': `${{ square: 4, soft: 16, round: 24 }[value.corners]}px`
  };
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  root.dataset.reduceMotion = String(value.reduceMotion);
}

export function paintAppearance(ui: UiPrefs) {
  current = ui.appearance ?? defaultAppearance(); theme = ui.theme;
  applyAppearance(current);
  if (!dialog) return;
  for (const label of dialog.querySelectorAll<HTMLElement>('[data-copy]')) label.textContent = translate(label.dataset.copy!);
  for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-preference]')) {
    const key = control.dataset.preference as keyof Appearance | 'theme';
    if (control === document.activeElement) continue;
    const value = key === 'theme' ? theme : current[key];
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = String(value);
    const output = control.parentElement?.querySelector('output'); if (output) output.value = String(value);
  }
}

export function initAppearance(save: (over: { appearance?: Appearance; theme?: UiPrefs['theme'] }) => Promise<void>) {
  dialog = document.createElement('dialog'); dialog.className = 'appearance-dialog'; dialog.id = 'appearanceDialog'; dialog.setAttribute('aria-labelledby', 'appearanceTitle');
  const copy = (tag: string, text: string) => { const element = document.createElement(tag); element.dataset.copy = text; element.textContent = translate(text); return element; };
  const heading = document.createElement('header'); const title = copy('h2', 'Customize appearance'); title.id = 'appearanceTitle';
  const close = copy('button', 'Done') as HTMLButtonElement; close.type = 'button';
  heading.append(title, close); dialog.append(heading, copy('p', 'Changes are applied immediately and saved for this app.'));
  const content = document.createElement('div'); content.className = 'appearance-content'; dialog.append(content);
  const grid = document.createElement('div'); grid.className = 'appearance-fields'; content.append(grid);
  function field(key: keyof Appearance | 'theme', label: string, options: [string, string][] | { min: number; max: number; step: number } | 'color' | 'checkbox') {
    const row = document.createElement('label'); row.append(copy('span', label));
    let control: HTMLInputElement | HTMLSelectElement;
    if (Array.isArray(options)) {
      control = document.createElement('select');
      for (const [value, caption] of options) { const option = copy('option', caption) as HTMLOptionElement; option.value = value; control.append(option); }
    } else {
      control = document.createElement('input'); control.type = typeof options === 'string' ? options : 'range';
      if (typeof options === 'object') { control.min = String(options.min); control.max = String(options.max); control.step = String(options.step); row.append(document.createElement('output')); }
    }
    control.dataset.preference = key; row.append(control); grid.append(row);
    const read = () => {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') return control.checked;
      return control instanceof HTMLInputElement && control.type === 'range' ? Number(control.value) : control.value;
    };
    control.addEventListener('input', () => {
      if (key === 'theme') return;
      const output = row.querySelector('output'); if (output) output.value = String(read());
      applyAppearance({ ...current, [key]: read() });
    });
    control.addEventListener('change', () => {
      if (key === 'theme') { theme = control.value as UiPrefs['theme']; void save({ theme }); }
      else { current = { ...current, [key]: read() }; applyAppearance(current); void save({ appearance: current }); }
    });
  }
  field('theme', 'Color theme', [['dark', 'Dark'], ['light', 'Light']]);
  field('accent', 'Accent color', 'color');
  field('font', 'Interface font', [['system', 'System default'], ['sans', 'Sans serif'], ['serif', 'Serif'], ['mono', 'Monospace']]);
  field('textSize', 'Text size', { min: 12, max: 20, step: 1 });
  field('codeFont', 'Code font', [['cascadia', 'Cascadia Code'], ['consolas', 'Consolas'], ['courier', 'Courier New']]);
  field('codeSize', 'Code text size', { min: 11, max: 18, step: 1 });
  field('density', 'Interface density', [['compact', 'Dense spacing'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]);
  field('chatWidth', 'Conversation width', { min: 600, max: 1100, step: 20 });
  field('corners', 'Corner style', [['square', 'Square'], ['soft', 'Soft'], ['round', 'Round']]);
  field('reduceMotion', 'Reduce motion', 'checkbox');
  const preview = document.createElement('div'); preview.className = 'appearance-preview'; preview.append(copy('strong', 'Appearance preview'), copy('p', 'Your messages and code use independent font sizes.'));
  const code = document.createElement('code'); code.textContent = 'const greeting = "你好，世界";'; preview.append(code); content.append(preview);
  const reset = copy('button', 'Restore appearance defaults') as HTMLButtonElement; reset.type = 'button'; reset.className = 'btn';
  reset.addEventListener('click', () => { current = defaultAppearance(); theme = 'dark'; paintAppearance({ appearance: current, theme } as UiPrefs); void save({ appearance: current, theme }); });
  dialog.append(reset); document.body.append(dialog);
  const opener = document.getElementById('customizeAppearance')!;
  opener.addEventListener('click', () => { paintAppearance({ appearance: current, theme } as UiPrefs); dialog!.showModal(); });
  close.addEventListener('click', () => dialog!.close());
  dialog.addEventListener('close', () => document.querySelector<HTMLElement>('#appearanceMenu > summary')?.focus());
}
