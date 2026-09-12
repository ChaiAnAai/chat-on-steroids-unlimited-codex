import { z } from 'zod';

export const ACCENTS = ['neutral', 'blue', 'teal', 'violet', 'amber'] as const;
export const appearanceSchema = z.object({
  accent: z.enum(ACCENTS).default('neutral'),
  interfaceSize: z.union([z.literal(13), z.literal(14), z.literal(15), z.literal(16)]).default(14),
  codeSize: z.union([z.literal(12), z.literal(13), z.literal(14), z.literal(15), z.literal(16)]).default(13),
  density: z.enum(['comfortable', 'compact']).default('comfortable')
});
export type Appearance = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE: Appearance = appearanceSchema.parse({});
export type ThemeMode = 'light' | 'dark' | 'system';
export const resolvedTheme = (mode: ThemeMode, systemDark: boolean): 'light' | 'dark' =>
  mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
