import { app, dialog } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { SkillLibrary } from './library.js';
import { getProject } from '../projects.js';
import { getSession } from '../session/store.js';
import { inboundAccountPrincipal, accountPrincipalCurrent } from '../mcp/account-guard.js';
import type { SkillResponse } from '../../shared/skills.js';

let instance: SkillLibrary | undefined;
export const skillLibrary = () => instance ??= new SkillLibrary(path.join(app.getPath('userData'), 'skills'));
const name = z.string().min(1).max(64);
const request = z.discriminatedUnion('action', [z.object({ action: z.literal('list') }).strict(), z.object({ action: z.literal('import') }).strict(),
  z.object({ action: z.enum(['commit', 'discard']), token: z.string().uuid() }).strict(),
  z.object({ action: z.enum(['details', 'rollback']), name }).strict(),
  z.object({ action: z.literal('enable'), name, projectId: z.string().uuid(), enabled: z.boolean() }).strict()]);
export async function manageSkills(payload: unknown): Promise<SkillResponse> {
  const input = request.parse(payload), library = skillLibrary();
  if (input.action === 'import') {
    const selection = await dialog.showOpenDialog({ title: 'Import SKILL.md folder / 导入技能文件夹', properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return library.preview(selection.filePaths[0]);
  }
  if (input.action === 'details') return library.details(input.name);
  if (input.action === 'commit') await library.commit(input.token);
  if (input.action === 'discard') { await library.discard(input.token); return null; }
  if (input.action === 'rollback') await library.rollback(input.name);
  if (input.action === 'enable') {
    const project = await getProject(input.projectId);
    if (!project || project.ungrouped) throw new Error('Choose an existing project first');
    await library.enable(input.name, project.id, input.enabled);
  }
  return { skills: await library.list() };
}
/** A virtual resource is read-only and requires a proven project from the existing caller. */
export async function readSkillResource(sessionId: string | null | undefined, requested: string): Promise<string> {
  const principal = inboundAccountPrincipal();
  const session = sessionId ? await getSession(sessionId) : null;
  if (!session?.projectId) throw new Error('Skills require a conversation with a confirmed project');
  const match = /^\/skills\/([a-z0-9-]+)\/([a-f0-9]{64})\/(.+)$/.exec(requested);
  if (!match) throw new Error('Use the exact versioned skill path supplied by the app');
  const result = await skillLibrary().read(session.projectId, match[1]!, match[2]!, match[3]!);
  if (!await accountPrincipalCurrent(principal) || (await getSession(session.id))?.projectId !== session.projectId) throw new Error('Skill caller changed during read');
  return result;
}
