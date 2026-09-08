export const LANGUAGE_CODES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de'] as const;
export type LanguageCode = typeof LANGUAGE_CODES[number];
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', ja: '日本語',
  ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch'
};
