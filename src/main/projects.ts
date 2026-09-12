import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rawPromises as fs } from './rawfs.js';
import { readDurable, writeDurableNow } from './durable.js';
import { getConfig } from './config.js';
import { resolvePath } from './sandbox.js';
import { bindSessionProject, findSessionByConversation, getSession, indexedSessions } from './session/store.js';
import type { LocalProject } from '../shared/projects.js';

const projectSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(160), path: z.string().min(1).max(32768), createdAt: z.number().finite().nonnegative(), ungrouped: z.boolean().optional(), mainSessionId: z.string().min(8).max(64).optional(), lastOpenedAt: z.number().finite().nonnegative().optional() });
const catalogSchema = z.array(projectSchema.extend({ defaultAccountId: z.string().uuid().optional() })).max(200);
let mutations: Promise<unknown> = Promise.resolve();
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export async function listProjects(): Promise<LocalProject[]> {
  const raw = await readDurable<unknown>('projects');
  if (raw === null) return [];
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success || new Set(parsed.data.map(row => row.id)).size !== parsed.data.length) throw new Error('Project catalog is invalid');
  return parsed.data;
}
export async function getProject(id: string): Promise<LocalProject | null> {
  return (await listProjects()).find(project => project.id === id) ?? null;
}
/** Changing a default never changes the account of an existing conversation. */
export function bindProjectAccount(id: string, accountId: string): Promise<LocalProject> {
  const work = mutations.then(async () => {
    z.string().uuid().parse(accountId);
    const account = await (await import('./accounts.js')).getAccount(accountId);
    if (!account) throw new Error('Account not found');
    const catalog = await listProjects();
    const project = catalog.find(row => row.id === id);
    if (!project) throw new Error('Project not found');
    if (project.defaultAccountId === accountId) return project;
    const history = (await indexedSessions()).filter(row => row.projectId === id);
    if (history.some(row => row.accountId !== accountId)) throw new Error('Confirm the original account of existing history before changing this project. No conversation was reassigned.');
    const inputs = await (await import('./session/input.js')).listInputs();
    if (inputs.some(row => row.projectId === id && !['sent', 'cancelled', 'failed'].includes(row.state))) throw new Error('Stop or cancel pending project work before changing its account');
    const updated = { ...project, defaultAccountId: accountId };
    await writeDurableNow('projects', catalog.map(row => row.id === id ? updated : row));
    return updated;
  });
  mutations = work.catch(() => undefined);
  return work;
}
/** Folder picker callers approve roots separately; project selection cannot widen them. */
export function addProject(folderPath: string): Promise<LocalProject> {
  const operation = mutations.then(async () => {
    if (!path.isAbsolute(folderPath)) throw new Error('Choose an absolute local project folder');
    const resolved = await resolvePath(getConfig().roots, folderPath);
    if (!(await fs.stat(resolved.real)).isDirectory()) throw new Error('Choose a project folder');
    const projects = await listProjects();
    const existing = projects.find(project => samePath(project.path, resolved.real));
    if (existing) {
      if (!existing.ungrouped) return existing;
      const { ungrouped: _, ...restored } = existing;
      await writeDurableNow('projects', projects.map(project => project.id === existing.id ? restored : project));
      return restored;
    }
    if (projects.length >= 200) throw new Error('Project catalog limit reached');
    const project: LocalProject = { id: randomUUID(), name: (path.basename(resolved.real) || resolved.real).slice(0, 160), path: resolved.real, createdAt: Date.now() };
    await writeDurableNow('projects', [...projects, project]);
    return project;
  });
  mutations = operation.catch(() => undefined);
  return operation;
}
/** Remove only the grouping. One catalog commit also covers unloaded sessions and
 * in-flight inputs without rewriting their durable workspace/receipt identities. */
export function removeProject(id: string): Promise<LocalProject> {
  const operation = mutations.then(async () => {
    z.string().uuid().parse(id);
    const projects = await listProjects();
    const project = projects.find(row => row.id === id);
    if (!project) throw new Error('Project not found');
    const removed = { ...project, ungrouped: true };
    if (!project.ungrouped) await writeDurableNow('projects', projects.map(row => row.id === id ? removed : row));
    return removed;
  });
  mutations = operation.catch(() => undefined);
  return operation;
}
export async function assignSessionProject(sessionId: string, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  await resolveProject(project);
  if (project.defaultAccountId && (await getSession(sessionId))?.accountId !== project.defaultAccountId) throw new Error('Session and project accounts do not match');
  await bindSessionProject(sessionId, project.id);
  if (!project.mainSessionId) await selectProjectSession(project.id, sessionId, false);
}

/** Catalog owns only the main reference; history and provider bindings remain in the session. */
export function selectProjectSession(projectId: string, preferred?: string, replace = true): Promise<string | null> {
  const work = mutations.then(async () => {
    const catalog = await listProjects();
    const project = catalog.find(row => row.id === projectId);
    if (!project) throw new Error('Project not found');
    const eligible = (await indexedSessions()).filter(row => row.projectId === projectId && (!project.defaultAccountId || row.accountId === project.defaultAccountId) && row.origin?.kind !== 'helper' && row.origin?.kind !== 'worker');
    const chosen = (replace && preferred ? eligible.find(row => row.id === preferred) : undefined) ?? eligible.find(row => row.id === project.mainSessionId) ??
      eligible.find(row => row.id === preferred) ?? eligible.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (preferred && replace && chosen?.id !== preferred) throw new Error('Choose a normal conversation in this project');
    if (replace || (chosen && chosen.id !== project.mainSessionId)) {
      if (replace && project.mainSessionId && chosen?.id !== project.mainSessionId) await (await import('./session/workflow.js')).pauseWorkflow(project.mainSessionId, 'main-conversation-replaced');
      await writeDurableNow('projects', catalog.map(row => row.id === projectId ? { ...row, mainSessionId: chosen?.id, ...(replace ? { lastOpenedAt: Date.now() } : {}) } : row));
    }
    return chosen?.id ?? null;
  });
  mutations = work.catch(() => undefined);
  return work;
}
export async function projectWorkspace(projectId: string): Promise<{ virtual: string; real: string }> {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  return resolveProject(project);
}
async function resolveProject(project: LocalProject): Promise<{ virtual: string; real: string }> {
  const resolved = await resolvePath(getConfig().roots, project.path);
  if (!samePath(resolved.real, project.path) || !(await fs.stat(resolved.real)).isDirectory()) throw new Error('Project folder changed or is unavailable');
  return { virtual: resolved.virtual, real: resolved.real };
}
/** Null means no project. A broken explicit binding is an error, never permission to guess cwd. */
export async function getSessionProject(sessionId: string): Promise<{ virtual: string; real: string } | null> {
  const session = await getSession(sessionId);
  if (!session?.projectId) return null;
  const project = await getProject(session.projectId);
  if (!project) throw new Error('The session project is unavailable');
  return resolveProject(project);
}
/** The broker supplies an exact prime conversation; unrelated families are never consulted. */
export async function inheritSessionProject(sessionId: string, primeConversationId: string): Promise<void> {
  const prime = await findSessionByConversation(primeConversationId, { requireUnique: true });
  if (prime?.conversationId !== primeConversationId || !prime.projectId) return;
  await assignSessionProject(sessionId, prime.projectId);
}
