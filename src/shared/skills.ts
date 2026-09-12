export interface SkillInfo {
  name: string; title: string; description: string; version: string; digest: string;
  source: 'builtin' | 'local'; compatibility: string; files: string[]; previous?: string;
  enabledProjects: string[];
}
export interface SkillImportPreview { token: string; skill: SkillInfo; replaces?: string }
export type SkillRequest = { action: 'list' } | { action: 'import' } |
  { action: 'commit' | 'discard'; token: string } | { action: 'details' | 'rollback'; name: string } |
  { action: 'enable'; name: string; projectId: string; enabled: boolean };
export type SkillResponse = { skills: SkillInfo[] } | SkillImportPreview | { skill: SkillInfo; markdown: string } | null;
