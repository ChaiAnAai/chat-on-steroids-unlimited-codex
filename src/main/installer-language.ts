import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Installer seed is only consulted when no existing app language has been chosen. */
export function readInstallerLanguage(resourcesPath: string): 'en' | 'zh-CN' | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(resourcesPath, 'installer-language.json'), 'utf8'));
    const language = (value as { language?: unknown })?.language;
    return language === 'en' || language === 'zh-CN' ? language : undefined;
  } catch { return undefined; }
}
