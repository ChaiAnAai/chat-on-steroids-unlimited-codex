import { z } from 'zod';

/** One validated format for disk, IPC and renderer preferences. */
export const appearanceSchema = z.object({
  font: z.enum(['system', 'sans', 'serif', 'mono']).default('system'),
  codeFont: z.enum(['cascadia', 'consolas', 'courier']).default('cascadia'),
  textSize: z.number().int().min(12).max(20).default(14),
  codeSize: z.number().int().min(11).max(18).default(13),
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#729ac8'),
  chatWidth: z.number().int().min(600).max(1100).default(760),
  corners: z.enum(['square', 'soft', 'round']).default('soft'),
  reduceMotion: z.boolean().default(false)
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance = (): Appearance => appearanceSchema.parse({});

export function mergeAppearance(live: Appearance | undefined, base: Appearance | undefined, wanted: Appearance | undefined): Appearance | undefined {
  if (!wanted) return live;
  const before = base ?? defaultAppearance();
  const current = live ?? defaultAppearance();
  return Object.fromEntries(Object.keys(wanted).map(key => {
    const field = key as keyof Appearance;
    return [field, Object.is(before[field], wanted[field]) ? current[field] : wanted[field]];
  })) as Appearance;
}
