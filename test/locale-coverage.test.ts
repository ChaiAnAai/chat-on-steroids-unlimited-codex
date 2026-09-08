import { expect, it, afterEach } from 'vitest';
import { LOCALES } from '../src/renderer/locales/index.js';
import { LANGUAGE_CODES } from '../src/shared/languages.js';
import { TRANSLATION_KEYS, setUiLanguage, translate, ui } from '../src/renderer/i18n.js';

afterEach(() => setUiLanguage('en'));
it('ships complete, nonempty locale dictionaries with intact substitution variables', () => {
  for (const language of LANGUAGE_CODES.filter(code => !['en', 'zh-CN'].includes(code))) {
    const dictionary = LOCALES[language]!;
    expect(dictionary, language).toBeDefined();
    for (const key of TRANSLATION_KEYS) {
      const value = dictionary[key]!;
      expect(value, `${language}: ${key}`).toBeTypeOf('string');
      if (key.trim()) expect(value.trim(), `${language}: ${key}`).not.toBe('');
      expect(value.match(/\{[a-zA-Z0-9_]+\}/g)?.sort() ?? [], `${language}: ${key}`).toEqual(key.match(/\{[a-zA-Z0-9_]+\}/g)?.sort() ?? []);
      expect(value).not.toMatch(/ZX[QV]\s*\d+/i);
    }
    setUiLanguage(language);
    expect(ui().settings).not.toBe('Settings');
    expect(translate('New task')).not.toBe('New task');
    expect(translate('Tools: {tools}', { tools: 'exec_command, read' })).toContain('exec_command, read');
  }
});
