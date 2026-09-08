import { expect, it } from 'vitest';
import { appearanceSchema, defaultAppearance, mergeAppearance } from '../src/shared/appearance.js';
import { applyAppearance } from '../src/renderer/appearance.js';

it('validates appearance values at the disk and IPC boundary', () => {
  expect(appearanceSchema.parse({}).chatWidth).toBe(760);
  for (const invalid of [{ textSize: 40 }, { accent: 'url(example)' }, { chatWidth: 2000 }, { font: 'unknown' }]) {
    expect(appearanceSchema.safeParse(invalid).success).toBe(false);
  }
  expect(() => applyAppearance(defaultAppearance())).not.toThrow();
});

it('merges individual changes without replacing a newer appearance from a stale snapshot', () => {
  const base = defaultAppearance();
  const live = { ...base, textSize: 18, accent: '#abcdef' };
  expect(mergeAppearance(live, { ...base }, { ...base, density: 'compact' })).toEqual({ ...live, density: 'compact' });
  expect(mergeAppearance(live, undefined, undefined)).toEqual(live);
  expect(mergeAppearance(live, live, defaultAppearance())).toEqual(defaultAppearance());
});
