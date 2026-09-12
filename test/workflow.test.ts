import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { flushDurable, initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { appendEvent, createSession, flushSessions, getSession, initSessionStore, resetSessionStoreForTests,
  setCommittedSessionEventListener, updateSessionWorkflow } from '../src/main/session/store.js';
import { acknowledgeBrowserInput, authorizeBrowserInput, claimBrowserInput, enqueueInput, listInputs, offerToolInput, resetInputForTests,
  type InputArgs } from '../src/main/session/input.js';
import { acceptWorkflowInput, controlWorkflow, pauseRestoredWorkflows, planningToolAllowed, processWorkflowEvent,
  reportCheckpoint, workflowInputAllowed } from '../src/main/session/workflow.js';
import { observeUsage } from '../src/main/session/usage.js';
import { newWorkflow, classifyFailure } from '../src/shared/workflow.js';
import { makeTempDir, removeTempDir } from './helpers.js';
let directory: string;
it('classifies the observed Chinese history access restriction separately from model quota', () => {
  expect(classifyFailure('请求过于频繁 你的请求过于频繁。为保障数据安全，我们已暂时限制你访问对话记录。请稍等几分钟后再重试。')).toBe('access-restricted');
  expect(classifyFailure('We have temporarily limited access to conversations to protect your data.')).toBe('access-restricted');
  expect(classifyFailure('Model usage limit reached')).toBe('quota');
});
let sessionId: string;
const conversationId = 'conversation-workflow-acceptance';
const userInput = (patch: Partial<InputArgs> = {}): InputArgs => ({ id: randomUUID(), sessionId,
  text: 'Continue this project', mode: 'auto', dueAt: Date.now(), model: null, reasoningEffort: null, ...patch });
async function start(turnId: string): Promise<void> {
  const event = await appendEvent(sessionId, { kind: 'turn_start', source: 'extension', time: Date.now(), turnId });
  await processWorkflowEvent(sessionId, event);
}
async function finish(turnId: string): Promise<void> {
  const event = await appendEvent(sessionId, { kind: 'turn_end', source: 'extension', time: Date.now(), turnId, outcome: 'completed' });
  await processWorkflowEvent(sessionId, event);
}
async function checkpoint(turnId: string, evidence: string[] = ['test evidence']): Promise<void> {
  const workflow = (await getSession(sessionId))!.workflow!;
  await reportCheckpoint(sessionId, conversationId, turnId, Date.now(), {
    revision: workflow.revision, outcome: 'continue', summary: 'Finished a bounded step', next: 'Verify the next step', evidence
  });
}
beforeEach(async () => {
  directory = await makeTempDir('cos-workflow-acceptance-'); initConfigPath(directory); initDurableStore(directory);
  initSessionStore(directory); resetSessionStoreForTests(); resetInputForTests(); setCommittedSessionEventListener(null);
  const config = defaultConfig(); await saveConfig({ ...config, sessions: { ...config.sessions, record: true }, goal: { ...config.goal, executionPolicy: 'same-session' } });
  sessionId = (await createSession({ title: 'One project conversation', conversationId, origin: { kind: 'desktop', fromSessionId: null, agentId: null, task: '' } })).id;
  observeUsage([{ model: 'shared', scope: 'shared', remaining: null, remainingPercent: 80, resetAt: null, windowSeconds: null }]);
  await controlWorkflow(sessionId, 'goal', 'Deliver the requested upgrade');
});
afterEach(async () => {
  setCommittedSessionEventListener(null); await flushSessions(); await flushDurable();
  resetSessionStoreForTests(); resetInputForTests(); resetDurableForTests(); await removeTempDir(directory);
});

describe('same-conversation workflow durable acceptance', () => {
  it('reserves exactly ten subsequent turns and then preserves a paused project', async () => {
    for (let index = 0; index <= 10; index++) {
      const turn = `turn-${index}`; await start(turn); await checkpoint(turn, [`Evidence ${index}`]); await finish(turn);
      const workflow = (await getSession(sessionId))!.workflow!;
      if (index === 10) { expect(workflow.used).toBe(10); expect(workflow.pause).toBe('segment-budget'); break; }
      expect(workflow.used).toBe(index + 1);
      const input = (await listInputs()).find(row => row.id === workflow.pending?.id)!;
      expect(input.sessionId).toBe(sessionId); expect(input.conversationId).toBe(conversationId);
      expect(await claimBrowserInput(input.id, 'acceptance-browser', conversationId, true)).not.toBeNull();
      expect(await authorizeBrowserInput(input.id, 'acceptance-browser', conversationId)).toBe(true);
      expect(await acknowledgeBrowserInput(input.id, 'acceptance-browser', conversationId, `message-${index}`)).toBe(true);
    }
    expect((await listInputs()).filter(row => row.workflowRevision !== undefined)).toHaveLength(10);
  });
  it('does not continue from a normal end without a valid checkpoint', async () => {
    await start('no-checkpoint'); await finish('no-checkpoint'); expect(await listInputs()).toEqual([]);
  });
  it('rejects checkpoints for old objective revisions and unrelated turn identities', async () => {
    await start('current'); const revision = (await getSession(sessionId))!.workflow!.revision;
    await expect(reportCheckpoint(sessionId, conversationId, 'old', Date.now(), { revision, outcome: 'completed', summary: 'Done', evidence: [] })).rejects.toThrow('STALE_CHECKPOINT');
    await acceptWorkflowInput(sessionId, userInput({ objective: 'Changed request' }));
    await expect(reportCheckpoint(sessionId, conversationId, 'current', Date.now(), { revision, outcome: 'completed', summary: 'Old result', evidence: [] })).rejects.toThrow('STALE_CHECKPOINT');
  });
  it('rejects a call that began before the currently bound turn instead of relabeling it as current', async () => {
    const startedBeforeTurn = Date.now() - 1000; await start('fresh-turn');
    const revision = (await getSession(sessionId))!.workflow!.revision;
    await expect(reportCheckpoint(sessionId, conversationId, 'fresh-turn', startedBeforeTurn, {
      revision, outcome: 'completed', summary: 'Delayed old invocation', evidence: []
    })).rejects.toThrow('STALE_CHECKPOINT');
  });
  it('handles duplicated completion events without reserving or queueing twice', async () => {
    await start('dedupe'); await checkpoint('dedupe');
    const event = await appendEvent(sessionId, { kind: 'turn_end', source: 'extension', time: Date.now(), turnId: 'dedupe', outcome: 'completed' });
    await Promise.all([processWorkflowEvent(sessionId, event), processWorkflowEvent(sessionId, event)]);
    expect((await getSession(sessionId))!.workflow!.used).toBe(1); expect(await listInputs()).toHaveLength(1);
  });
  it('keeps reserved budget on restart but cancels automatic send eligibility', async () => {
    await start('restart'); await checkpoint('restart'); await finish('restart');
    const pending = (await listInputs())[0]!; expect(await workflowInputAllowed(pending)).toBe(true);
    await flushSessions(); await flushDurable(); resetSessionStoreForTests(); resetInputForTests();
    await pauseRestoredWorkflows();
    const workflow = (await getSession(sessionId))!.workflow!;
    expect(workflow.used).toBe(1); expect(workflow.pause).toBe('restart-review'); expect(await workflowInputAllowed(pending)).toBe(false);
  });
  it('pauses when provider quota is unknown and never substitutes local token estimates', async () => {
    observeUsage([]); await start('quota'); await checkpoint('quota'); await finish('quota');
    expect((await getSession(sessionId))!.workflow!.pause).toBe('quota-unknown'); expect(await listInputs()).toEqual([]);
  });
  it('stops after two distinct turns without new evidence', async () => {
    await start('empty-one'); await checkpoint('empty-one', []);
    await start('empty-two'); await checkpoint('empty-two', []);
    expect((await getSession(sessionId))!.workflow).toMatchObject({ noProgress: 2, pause: 'no-progress' });
  });
  it('clears a provisional no-progress pause when the same turn later produces actual evidence', async () => {
    await start('empty-one'); await checkpoint('empty-one', []);
    await start('empty-two'); await checkpoint('empty-two', []);
    await checkpoint('empty-two', ['Verified output file']);
    expect((await getSession(sessionId))!.workflow!.noProgress).toBe(0);
    expect((await getSession(sessionId))!.workflow!.pause).not.toBe('no-progress');
  });
  it('planning allows reads but denies shell, desktop and plugin mutations', async () => {
    await updateSessionWorkflow(sessionId, session => ({ ...(session.workflow ?? newWorkflow()), intent: 'plan' }));
    expect(await planningToolAllowed(sessionId, 'read', 'core')).toBe(true);
    expect(await planningToolAllowed(sessionId, 'exec_command', 'core')).toBe(false);
    expect(await planningToolAllowed(sessionId, 'write_stdin', 'core')).toBe(false);
    expect(await planningToolAllowed(sessionId, 'click', 'desktop')).toBe(false);
    expect(await planningToolAllowed(sessionId, 'plugin.write', 'plugins')).toBe(false);
  });
  it('cannot bypass an active planning restriction by omitting caller identity', async () => {
    await updateSessionWorkflow(sessionId, session => ({ ...(session.workflow ?? newWorkflow()), intent: 'plan' }));
    expect(await planningToolAllowed(null, 'exec_command', 'core')).toBe(false);
  });
  it('does not change planning intent when the requested send fails validation', async () => {
    await updateSessionWorkflow(sessionId, session => ({ ...session.workflow!, intent: 'plan' }));
    const before = (await getSession(sessionId))!.workflow!;
    await expect(enqueueInput(userInput({ intent: 'execute', projectId: randomUUID() }))).rejects.toThrow();
    const after = (await getSession(sessionId))!.workflow!;
    expect(after.intent).toBe('plan'); expect(after.revision).toBe(before.revision);
  });
  it('lets a new user instruction supersede an automatic continuation that has not been offered', async () => {
    await start('supersede'); await checkpoint('supersede'); await finish('supersede');
    const automatic = (await listInputs())[0]!;
    const next = await enqueueInput(userInput({ text: 'Change the objective before continuing' }));
    expect(next.state).toBe('queued');
    expect((await listInputs()).find(row => row.id === automatic.id)?.state).toBe('cancelled');
  });
  it('never injects a revoked automatic continuation through the tool transport', async () => {
    await start('revoke'); await checkpoint('revoke'); await finish('revoke');
    await controlWorkflow(sessionId, 'off');
    const batch = await offerToolInput(sessionId, conversationId, 'late-tool-request', Date.now() + 1);
    expect(batch.messages).toEqual([]);
  });
  it('ignores an old stopped-turn event after the user starts a new objective', async () => {
    await start('old-turn'); await controlWorkflow(sessionId, 'goal', 'New objective'); await start('new-turn');
    const late = await appendEvent(sessionId, { kind: 'turn_end', turnId: 'old-turn', outcome: 'stopped', source: 'extension', time: Date.now() });
    await processWorkflowEvent(sessionId, late);
    expect((await getSession(sessionId))!.workflow!.pause).toBeUndefined();
  });
});
