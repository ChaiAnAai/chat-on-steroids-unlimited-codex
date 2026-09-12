import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readInstallerLanguage } from '../src/main/installer-language.js';

describe('installer language seed', () => {
  it('reads only recognized language values and treats missing or invalid seeds as absent', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'cos-installer-language-'));
    try {
      expect(readInstallerLanguage(directory)).toBeUndefined();
      for (const language of ['zh-CN', 'en'] as const) {
        writeFileSync(path.join(directory, 'installer-language.json'), JSON.stringify({ language }));
        expect(readInstallerLanguage(directory)).toBe(language);
      }
      writeFileSync(path.join(directory, 'installer-language.json'), '{broken');
      expect(readInstallerLanguage(directory)).toBeUndefined();
      writeFileSync(path.join(directory, 'installer-language.json'), '{"language":"unknown"}');
      expect(readInstallerLanguage(directory)).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
