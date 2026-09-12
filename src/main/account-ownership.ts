import type { InputEntry } from './session/input.js';
import { getSession, indexedSessions, readRecentEvents } from './session/store.js';
import { getProject } from './projects.js';
import { assertAccountConnection } from './accounts.js';
import { currentAccountTransport } from './account-context.js';

/** Resolve ownership before enqueue; UI selectors are never consulted here. */
export async function inputAccount(input: { sessionId: string | null; projectId?: string | null }): Promise<string | undefined> {
  const session = input.sessionId ? await getSession(input.sessionId) : null;
  const project = input.projectId ? await getProject(input.projectId) : null;
  if (session && project?.defaultAccountId && session.accountId !== project.defaultAccountId)
    throw new Error('This conversation belongs to a different or unconfirmed account. Use an explicit new conversation.');
  return session ? session.accountId : project?.defaultAccountId;
}

/** Rechecked inside the existing outbox transaction, including final send. */
export async function accountInputAllowed(entry: InputEntry): Promise<boolean> {
  if (!entry.accountId) {
    if (currentAccountTransport()) return false;
    // Explicitly associating old history does not also authorize its unowned pending messages.
    if (entry.sessionId && (await getSession(entry.sessionId))?.accountId) return false;
    if (entry.projectId && (await getProject(entry.projectId))?.defaultAccountId) return false;
    return true;
  }
  const principal = currentAccountTransport();
  if (!principal || principal.accountId !== entry.accountId ||
      (entry.connectionVersion !== undefined && principal.connectionVersion !== entry.connectionVersion)) return false;
  try {
    await assertAccountConnection({ ...principal, surface: 'bridge' });
    if (entry.sessionId && (await getSession(entry.sessionId))?.accountId !== entry.accountId) return false;
    return true;
  } catch { return false; }
}

/** Uses existing queue/turn evidence; this is admission policy, not another scheduler. */
export async function accountProjectAvailable(entry: InputEntry, rows: InputEntry[]): Promise<boolean> {
  if (!entry.accountId) return true;
  const sessions = await indexedSessions();
  // A session-only send still inherits its durable project. Omitting a redundant UI
  // project selector must not bypass scheduling or the shared-directory writer fence.
  const withProject = (row: InputEntry): InputEntry => ({ ...row, projectId: row.projectId ??
    sessions.find(session => session.id === (row.sessionId ?? row.deliveredSessionId))?.projectId });
  entry = withProject(entry);
  rows = rows.map(withProject);
  const sameWork = (other: { projectId?: string | null; sessionId?: string | null }) => entry.projectId
    ? other.projectId === entry.projectId : other.sessionId === entry.sessionId;
  const busy = rows.filter(row => row.id !== entry.id && ['browser', 'tool'].includes(row.state));
  for (const row of rows) {
    if (row.id === entry.id || row.state !== 'sent' || !row.accountId) continue;
    const sessionId = row.sessionId ?? row.deliveredSessionId;
    const session = sessionId ? await getSession(sessionId) : null;
    // Browser acceptance precedes turn_start observation. Keep that existing receipt's
    // project occupied until a later positive end is recorded for its exact local session.
    const end = session?.accountId === row.accountId
      ? (await readRecentEvents(session.id, 1, { kinds: ['turn_end'] }))[0] : undefined;
    if (!Number.isFinite(row.deliveredAt) || !end || end.kind !== 'turn_end' || end.outcome === 'unknown' || end.time <= row.deliveredAt!) busy.push(row);
  }
  if (busy.some(row => row.accountId === entry.accountId && !sameWork(row))) return false;
  if (sessions.some(row => row.accountId === entry.accountId && row.activeTurnId &&
      !sameWork({ projectId: row.projectId, sessionId: row.id }))) return false;
  if (entry.intent === 'plan' || !entry.projectId) return true;
  const project = await getProject(entry.projectId);
  if (!project) return false;
  const normalized = (value: string) => (process.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value).replace(/\/+$/, '');
  // Parent/child project roots share potential output paths just as identical roots do.
  const overlaps = (left: string, right: string) => {
    const a = normalized(left), b = normalized(right);
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  };
  for (const row of busy) {
    if (row.accountId === entry.accountId || row.intent === 'plan' || !row.projectId) continue;
    const other = await getProject(row.projectId);
    if (other && overlaps(other.path, project.path)) return false;
  }
  for (const row of sessions) {
    if (!row.activeTurnId || row.accountId === entry.accountId || !row.projectId) continue;
    const other = await getProject(row.projectId);
    // Unknown execution intent is conservatively a writer.
    if (other && overlaps(other.path, project.path)) return false;
  }
  return true;
}
