import { randomUUID } from 'node:crypto';
import { checkpointSchema, classifyFailure, newWorkflow, sameSessionPolicy, WORKFLOW_LIMIT, type Checkpoint } from '../../shared/workflow.js';
import type { SessionEvent } from '../../shared/session.js';
import { getConfig } from '../config.js';
import { getSession, indexedSessions, readSessionPlan, updateSessionWorkflow, sessionsRoot } from './store.js';
import { readDurable, writeDurableNow } from '../durable.js';
import { accountAutomationQuota } from './usage.js';
import { enqueueInput, listInputs, cancelInput, type InputArgs } from './input.js';

// These are control intents in session metadata; the existing outbox owns delivery.
export async function acceptWorkflowInput(id: string, input: InputArgs): Promise<void> {
  if (!sameSessionPolicy(getConfig()) || input.workflowRevision !== undefined) return;
  await updateSessionWorkflow(id, session => {
    const old = session.workflow ?? newWorkflow();
    if (old.lastInputId === input.id) return old;
    return { ...old, revision: old.revision + 1, lastInputId: input.id,
      intent: input.intent ?? old.intent, objective: input.objective ?? old.objective,
      mode: input.intent === 'plan' ? 'off' : input.automation ?? old.mode,
      checkpoint: undefined, pending: undefined,
      pause: input.intent === 'plan' ? 'planning' : old.pause === 'planning' && input.intent === 'execute' ? undefined : old.pause };
  });
}
export async function pauseWorkflow(id: string, reason: string): Promise<void> {
  const session = await getSession(id);
  if (!session?.workflow) return;
  const pending = session.workflow.pending?.id;
  await updateSessionWorkflow(id, current => ({ ...current.workflow!, revision: current.workflow!.revision + 1, pause: reason, checkpoint: undefined, pending: undefined }));
  if (pending) await cancelInput(pending);
}
export async function controlWorkflow(id: string, action: 'resume' | 'off' | 'goal' | 'loop', objective?: string): Promise<void> {
  await updateSessionWorkflow(id, current => {
    const old = current.workflow ?? newWorkflow();
    return { ...old, revision: old.revision + 1, objective: objective ?? old.objective,
      mode: action === 'resume' ? old.mode === 'off' ? 'goal' : old.mode : action,
      intent: old.intent, used: action === 'resume' || old.mode === 'off' ? 0 : old.used,
      segment: action === 'resume' || old.mode === 'off' ? old.segment + 1 : old.segment,
      noProgress: 0, pause: action === 'off' ? 'automation-off' : undefined, checkpoint: undefined, pending: undefined };
  });
}
export async function reportCheckpoint(id: string, conversationId: string, turnId: string, startedAt: number, raw: Checkpoint): Promise<string> {
  const checkpoint = checkpointSchema.parse(raw);
  const plan = await readSessionPlan(id);
  const completed = plan?.plan.filter(step => step.status === 'completed').map(step => step.step) ?? [];
  await updateSessionWorkflow(id, session => {
    const old = session.workflow ?? newWorkflow();
    if (session.conversationId !== conversationId || session.activeTurnId !== turnId || old.revision !== checkpoint.revision ||
        (session.finishTurn?.startedAt !== undefined && startedAt < session.finishTurn.startedAt))
      throw new Error(`STALE_CHECKPOINT: current objective revision is ${old.revision}. Read the current session before updating.`);
    if (old.checkpoint?.at && old.checkpoint.at > startedAt) throw new Error('STALE_CHECKPOINT: a newer checkpoint already exists');
    const progress = checkpoint.evidence.some(value => !old.evidence.includes(value)) || completed.some(value => !old.completedSteps.includes(value));
    const noProgress = progress ? 0 : old.checkpoint?.turnId === turnId ? old.noProgress : old.noProgress + 1;
    return { ...old, checkpoint: { ...checkpoint, turnId, conversationId, at: startedAt }, noProgress,
      evidence: [...new Set([...old.evidence, ...checkpoint.evidence])].slice(-100), completedSteps: completed,
      pause: checkpoint.outcome === 'blocked' ? 'blocked' : noProgress >= 2 && checkpoint.outcome === 'continue' ? 'no-progress' : progress && old.pause === 'no-progress' ? undefined : old.pause };
  });
  return 'Checkpoint saved. It does not start another turn. Finish the current meaningful work; provider completion, user instructions and local limits decide continuation.';
}
const restrictionKey = (accountId?: string) => accountId ? `limit-${accountId.replace(/-/g, '')}` : 'connection-restriction';
export async function connectionRestriction(accountId?: string): Promise<string | null> {
  const saved = await readDurable<{ reason?: string }>(restrictionKey(accountId));
  return saved?.reason ?? null;
}
export async function clearConnectionRestriction(accountId?: string): Promise<void> { await writeDurableNow(restrictionKey(accountId), null); }
export async function workflowInputAllowed(input: InputArgs & { finishOwner?: unknown; purpose?: string; accountId?: string }): Promise<boolean> {
  const accountId = input.accountId ?? (input.sessionId ? (await getSession(input.sessionId))?.accountId : undefined);
  if (await connectionRestriction(accountId)) return false;
  if (sameSessionPolicy(getConfig()) && (input.finishOwner || input.purpose === 'decision')) return false;
  if (input.workflowRevision === undefined) return true;
  const session = input.sessionId ? await getSession(input.sessionId) : null;
  const workflow = session?.workflow;
  return !!workflow && workflow.intent === 'execute' && !workflow.pause && workflow.mode !== 'off' && workflow.revision === input.workflowRevision && workflow.pending?.id === input.id && !await accountAutomationQuota(session?.selectedModel?.model, getConfig().goal.reservePercent ?? 10, session?.accountId);
}
export async function processWorkflowEvent(id: string, event: SessionEvent): Promise<void> {
  if (!sameSessionPolicy(getConfig())) return;
  if (event.kind === 'user_message' && !event.inputId && event.messageId && event.source === 'extension') {
    const session = await getSession(id);
    // Historical backfill cannot cancel a current instruction. Provider edits with the same
    // message id remain idempotent; browser input does not grant execute permission.
    if (session?.workflow && event.time >= (session.finishTurn?.startedAt ?? session.updatedAt)) {
      await acceptWorkflowInput(id, { id: `browser:${event.messageId}`, sessionId: id, text: event.message.text,
        mode: 'auto', dueAt: event.time, model: null, reasoningEffort: null });
    }
    return;
  }
  if (event.kind === 'turn_start') {
    const session = await getSession(id);
    const pending = session?.workflow?.pending;
    if (pending && event.turnId !== pending.turnId && session?.finishTurn?.turnId === event.turnId)
      await updateSessionWorkflow(id, current => current.workflow?.pending?.id === pending.id && current.finishTurn?.turnId === event.turnId
        ? { ...current.workflow, pending: undefined, checkpoint: undefined } : current.workflow!);
    return;
  }
  if (event.kind === 'chat_error') {
    const kind = classifyFailure(event.message.text);
    if (kind === 'access-restricted') await writeDurableNow(restrictionKey((await getSession(id))?.accountId), { reason: event.message.text.slice(0, 2000), at: event.time });
    await pauseWorkflow(id, kind);
    return;
  }
  if (event.kind !== 'turn_end') return;
  const session = await getSession(id);
  if (event.outcome !== 'completed') {
    if (event.turnId && session?.finishTurn?.turnId === event.turnId) await pauseWorkflow(id, event.outcome);
    return;
  }
  const workflow = session?.workflow;
  const checkpoint = workflow?.checkpoint;
  if (!session || !workflow || !checkpoint || workflow.intent === 'plan' || workflow.mode === 'off' || workflow.pause || workflow.pending ||
      checkpoint.turnId !== event.turnId || checkpoint.conversationId !== session.conversationId || checkpoint.revision !== workflow.revision) return;
  if (checkpoint.outcome === 'completed') {
    await updateSessionWorkflow(id, current => current.workflow?.revision === workflow.revision && current.workflow.checkpoint?.turnId === event.turnId
      ? { ...current.workflow, mode: 'off', pause: 'completed', pending: undefined } : current.workflow!);
    return;
  }
  if (checkpoint.outcome !== 'continue') return;
  const queued = await listInputs();
  if (queued.some(row => row.sessionId === id && !['sent', 'failed', 'cancelled'].includes(row.state))) { await pauseWorkflow(id, 'user-input-pending'); return; }
  const blocked = await connectionRestriction(session.accountId) ? 'access-restricted' : await accountAutomationQuota(session.selectedModel?.model, getConfig().goal.reservePercent ?? 10, session.accountId);
  if (blocked || workflow.used >= WORKFLOW_LIMIT) { await pauseWorkflow(id, blocked ?? 'segment-budget'); return; }
  const inputId = randomUUID();
  const reserved = await updateSessionWorkflow(id, current => {
    const live = current.workflow!;
    if (live.revision !== workflow.revision || live.pending || live.pause || live.checkpoint?.turnId !== event.turnId) return live;
    return { ...live, used: live.used + 1, pending: { id: inputId, turnId: event.turnId!, revision: live.revision } };
  });
  if (reserved.workflow?.pending?.id !== inputId) return;
  try {
    await enqueueInput({ id: inputId, sessionId: id, text: `Continue the current project in this conversation. Preserve the original objective and latest user corrections.\nNext step: ${checkpoint.next}\nReport session(action="checkpoint") with revision ${workflow.revision} before the final answer. Do not create helper chats.`,
      mode: 'auto', dueAt: Date.now(), model: null, reasoningEffort: null, workflowRevision: workflow.revision });
  } catch (error) { await pauseWorkflow(id, 'continuation-not-queued'); throw error; }
}
export async function pauseRestoredWorkflows(): Promise<void> {
  for (const session of await indexedSessions()) if (session.workflow?.mode !== 'off' && session.workflow) await pauseWorkflow(session.id, 'restart-review');
}

/** Planning never grants arbitrary shell/plugin/desktop mutations, even through code mode. */
export async function planningToolAllowed(sessionId: string | null | undefined, name: string, surface: string): Promise<boolean> {
  // MCP unit callers can exercise the kernel before a durable store is mounted. There is no
  // planning session to fence in that state; production mounts the store during startup.
  if (!sessionsRoot()) return true;
  const session = sessionId ? await getSession(sessionId) : null;
  const planning = session ? session.workflow?.intent === 'plan' : (await indexedSessions()).some(row => row.workflow?.intent === 'plan');
  if (!planning) return true;
  return surface === 'core' && ['read', 'find', 'view_image', 'session', 'update_plan', 'session_finish', 'exec'].includes(name);
}
