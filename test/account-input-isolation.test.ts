import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const accounts = vi.hoisted(() => new Map<string, { id: string; connectionVersion: number; connected: boolean; paused: boolean }>());
// Real sessions/projects/outbox; only provider-connection evidence is injected and explicit.
vi.mock('../src/main/accounts.js', () => ({
  listAccounts: async () => [...accounts.values()].map(row => ({ ...row })),
  getAccount: async (id: string) => accounts.get(id) ?? null,
  assertAccountConnection: async (principal: { accountId: string; connectionVersion: number }) => {
    const account = accounts.get(principal.accountId);
    if (!account?.connected || account.paused || account.connectionVersion !== principal.connectionVersion) throw new Error('Account authorization stale');
  }
}));
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { flushDurable, initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { appendEvent, bindSessionAccount, createSession, flushSessions, getSession, initSessionStore, resetSessionStoreForTests, setCommittedSessionEventListener } from '../src/main/session/store.js';
import { acknowledgeBrowserInput, authorizeBrowserInput, cancelInput, claimBrowserInput, configureInputDelivery, enqueueInput, listInputs, offerToolInput, resetInputForTests, type InputArgs } from '../src/main/session/input.js';
import { addProject, assignSessionProject, bindProjectAccount } from '../src/main/projects.js';
import { withAccountTransport } from '../src/main/account-context.js';
import { validateNewRoot } from '../src/main/sandbox.js';
import { accountProjectAvailable } from '../src/main/account-ownership.js';
let directory: string, root: string, a: string, b: string;
function asAccount<T>(id: string, operation: () => T, version = accounts.get(id)!.connectionVersion): T { return withAccountTransport({ accountId: id, connectionVersion: version }, operation); }
async function session(accountId: string, projectId?: string) {
  const row = await createSession({ title: 'Isolated work', conversationId: `conversation-${randomUUID()}` });
  await bindSessionAccount(row.id, accountId); if (projectId) await assignSessionProject(row.id, projectId);
  return (await getSession(row.id))!;
}
async function project(name: string, accountId: string) {
  const target = path.join(root, name); await fs.mkdir(target, { recursive: true });
  const row = await addProject(target); await bindProjectAccount(row.id, accountId); return row;
}
function input(sessionId: string | null, patch: Partial<InputArgs> = {}): InputArgs { return { id: randomUUID(), sessionId, text: 'Do the requested work', dueAt: Date.now(), mode: 'auto', model: null, reasoningEffort: null, ...patch }; }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-account-outbox-')); root = path.join(directory, 'approved'); await fs.mkdir(root);
  root = await validateNewRoot(root, []); initConfigPath(directory); initDurableStore(directory); initSessionStore(directory);
  resetSessionStoreForTests(); resetInputForTests(); setCommittedSessionEventListener(null); configureInputDelivery({ applyAutomation: async () => undefined, changed: () => undefined });
  const config = defaultConfig(); await saveConfig({ ...config, roots: [{ name: 'work', path: root }], goal: { ...config.goal, executionPolicy: 'same-session' } });
  accounts.clear(); a = randomUUID(); b = randomUUID();
  for (const id of [a, b]) accounts.set(id, { id, connectionVersion: 3, connected: true, paused: false });
});
afterEach(async () => { await flushSessions(); await flushDurable(); setCommittedSessionEventListener(null); resetSessionStoreForTests(); resetInputForTests(); resetDurableForTests(); accounts.clear(); await fs.rm(directory, { recursive: true, force: true }); });

it('freezes account ownership from session/project rather than caller-supplied selectors', async () => {
  const p = await project('one', a), s = await session(a, p.id);
  const forged = { ...input(s.id, { projectId: p.id }), accountId: b };
  const queued = await asAccount(b, () => enqueueInput(forged));
  expect(queued.accountId).toBe(a);
  await expect(bindProjectAccount(p.id, b)).rejects.toThrow();
  resetInputForTests(); expect((await listInputs())[0]!.accountId).toBe(a);
  await cancelInput(queued.id);
  const fresh = await enqueueInput(input(null, { projectId: p.id })); expect(fresh.accountId).toBe(a);
});
it('never reassigns a session account, including concurrent binds and restart', async () => {
  const s = await createSession({ title: 'Ownership race' });
  const outcomes = await Promise.allSettled([bindSessionAccount(s.id, a), bindSessionAccount(s.id, b)]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const owner = (await getSession(s.id))!.accountId!; expect([a, b]).toContain(owner);
  await flushSessions(); resetSessionStoreForTests();
  expect((await getSession(s.id))!.accountId).toBe(owner);
  await expect(bindSessionAccount(s.id, owner === a ? b : a)).rejects.toThrow('another account');
  await expect(bindSessionAccount(s.id, owner)).resolves.toBeUndefined();
});
it('rejects B claims, B final authorization and anonymous final authorization for A', async () => {
  const s = await session(a), queued = await enqueueInput(input(s.id));
  expect(await asAccount(b, () => claimBrowserInput(queued.id, 'document', s.conversationId, true))).toBeNull();
  expect(await asAccount(a, () => claimBrowserInput(queued.id, 'document', s.conversationId, true))).toMatchObject({ accountId: a, connectionVersion: 3 });
  expect(await asAccount(b, () => authorizeBrowserInput(queued.id, 'document', s.conversationId))).toBe(false);
  expect(await authorizeBrowserInput(queued.id, 'document', s.conversationId)).toBe(false);
  expect(await asAccount(a, () => authorizeBrowserInput(queued.id, 'document', s.conversationId))).toBe(true);
});
it('pins the claimed connection epoch through restart without handing A work to B or to a new A epoch', async () => {
  const s = await session(a), queued = await enqueueInput(input(s.id));
  await asAccount(a, () => claimBrowserInput(queued.id, 'document', s.conversationId, true));
  await flushSessions(); await flushDurable(); resetSessionStoreForTests(); resetInputForTests();
  accounts.get(a)!.connectionVersion++;
  expect((await listInputs())[0]).toMatchObject({ accountId: a, connectionVersion: 3, state: 'browser' });
  expect(await asAccount(b, () => claimBrowserInput(queued.id, 'document', s.conversationId, true))).toBeNull();
  expect(await asAccount(a, () => claimBrowserInput(queued.id, 'document', s.conversationId, true))).toBeNull();
  expect(await asAccount(a, () => authorizeBrowserInput(queued.id, 'document', s.conversationId), 3)).toBe(false);
  expect(await asAccount(a, () => authorizeBrowserInput(queued.id, 'document', s.conversationId))).toBe(false);
});
it('does not upgrade a stale transport to the current account epoch when claiming a never-sent row', async () => {
  const s = await session(a), queued = await enqueueInput(input(s.id));
  accounts.get(a)!.connectionVersion++;
  expect(await asAccount(a, () => claimBrowserInput(queued.id, 'stale', s.conversationId, true), 3)).toBeNull();
  expect(await asAccount(a, () => claimBrowserInput(queued.id, 'current', s.conversationId, true))).toMatchObject({ connectionVersion: 4 });
});
it('does not let a legacy unowned queued message follow a session that was later assigned to an account', async () => {
  const s = await createSession({ title: 'Unconfirmed history', conversationId: `conversation-${randomUUID()}` });
  const q = await enqueueInput(input(s.id)); expect(q.accountId).toBeUndefined();
  await bindSessionAccount(s.id, a);
  expect(await claimBrowserInput(q.id, 'legacy', s.conversationId, true)).toBeNull();
  expect(await asAccount(a, () => claimBrowserInput(q.id, 'account-a', s.conversationId, true))).toBeNull();
});
it('queues different projects on one account while another account can claim its own project', async () => {
  const p1 = await project('first', a), p2 = await project('second', a), p3 = await project('third', b);
  const s1 = await session(a, p1.id), s2 = await session(a, p2.id), s3 = await session(b, p3.id);
  const q1 = await enqueueInput(input(s1.id, { projectId: p1.id })), q2 = await enqueueInput(input(s2.id, { projectId: p2.id })), q3 = await enqueueInput(input(s3.id, { projectId: p3.id }));
  expect(await asAccount(a, () => claimBrowserInput(q1.id, 'one', s1.conversationId, true))).not.toBeNull();
  expect(await asAccount(a, () => claimBrowserInput(q2.id, 'two', s2.conversationId, true))).toBeNull();
  expect(await asAccount(b, () => claimBrowserInput(q3.id, 'three', s3.conversationId, true))).not.toBeNull();
});
it('uses a persisted active turn to keep same-account projects queued even without a claimed input', async () => {
  const p1 = await project('first', a), p2 = await project('second', a); const s1 = await session(a, p1.id), s2 = await session(a, p2.id);
  await appendEvent(s1.id, { kind: 'turn_start', time: Date.now(), turnId: 'active-owned-turn', source: 'extension' });
  const q2 = await enqueueInput(input(s2.id, { projectId: p2.id }));
  expect(await asAccount(a, () => claimBrowserInput(q2.id, 'two', s2.conversationId, true))).toBeNull();
});
it('does not expose A queued input through a B or anonymous tool result', async () => {
  const s = await session(a); await enqueueInput(input(s.id));
  expect((await asAccount(b, () => offerToolInput(s.id, s.conversationId, 'b-request', Date.now()))).messages).toEqual([]);
  expect((await offerToolInput(s.id, s.conversationId, 'anonymous-request', Date.now())).messages).toEqual([]);
  expect((await asAccount(a, () => offerToolInput(s.id, s.conversationId, 'a-request', Date.now()))).messages).toHaveLength(1);
});
it('does not accept another account delivery acknowledgement merely because document owner strings match', async () => {
  const s = await session(a), q = await enqueueInput(input(s.id));
  await asAccount(a, () => claimBrowserInput(q.id, 'same-document-string', s.conversationId, true));
  expect(await asAccount(b, () => acknowledgeBrowserInput(q.id, 'same-document-string', s.conversationId, 'wrong-account-message'))).toBe(false);
  expect((await listInputs())[0]!.state).toBe('browser');
});
it('does not permit different-account writers whose project roots overlap', async () => {
  const p1 = await project('parent', a), p2 = await project('parent/child', b); const s1 = await session(a, p1.id), s2 = await session(b, p2.id);
  // Callers can omit the redundant project selector; the durable session remains authoritative.
  const q1 = await enqueueInput(input(s1.id)), q2 = await enqueueInput(input(s2.id));
  const claimed = await asAccount(a, () => claimBrowserInput(q1.id, 'writer', s1.conversationId, true)); expect(claimed).not.toBeNull();
  expect(await accountProjectAvailable(q2, await listInputs())).toBe(false);
});
it('holds an acknowledged project before turn_start and releases only after a later known turn end', async () => {
  const p1 = await project('one', a), p2 = await project('two', a), s1 = await session(a, p1.id), s2 = await session(a, p2.id);
  const q1 = await enqueueInput(input(s1.id, { projectId: p1.id })), q2 = await enqueueInput(input(s2.id, { projectId: p2.id }));
  await asAccount(a, () => claimBrowserInput(q1.id, 'accepted', s1.conversationId, true));
  await asAccount(a, () => authorizeBrowserInput(q1.id, 'accepted', s1.conversationId));
  expect(await asAccount(a, () => acknowledgeBrowserInput(q1.id, 'accepted', s1.conversationId, 'accepted-message'))).toBe(true);
  const sent = (await listInputs()).find(row => row.id === q1.id)!;
  expect(sent.state).toBe('sent'); expect((await getSession(s1.id))!.activeTurnId).toBeNull();
  expect(await asAccount(a, () => claimBrowserInput(q2.id, 'next-project', s2.conversationId, true))).toBeNull();
  await appendEvent(s1.id, { kind: 'turn_end', source: 'extension', time: sent.deliveredAt! - 1, turnId: 'previous-turn', outcome: 'completed' });
  expect(await asAccount(a, () => claimBrowserInput(q2.id, 'next-project', s2.conversationId, true))).toBeNull();
  await appendEvent(s1.id, { kind: 'turn_end', source: 'extension', time: sent.deliveredAt! + 1, turnId: 'unknown-turn', outcome: 'unknown' });
  expect(await asAccount(a, () => claimBrowserInput(q2.id, 'next-project', s2.conversationId, true))).toBeNull();
  await appendEvent(s1.id, { kind: 'turn_end', source: 'extension', time: sent.deliveredAt! + 2, turnId: 'completed-turn', outcome: 'completed' });
  expect(await asAccount(a, () => claimBrowserInput(q2.id, 'next-project', s2.conversationId, true))).not.toBeNull();
});
