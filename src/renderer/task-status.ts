/** A projection of existing receipts and controls, never an execution authority. */
export interface TaskStatusInput {
  selected: boolean; known: boolean; active: boolean; stopping: boolean;
  blocked: boolean; compacting: boolean; pending: boolean; waitingAtFinish: boolean;
  error?: string | null;
}
export function taskStatus(input: TaskStatusInput): { label: string; tone: 'idle' | 'busy' | 'warning' | 'error'; detail: string } {
  if (!input.selected && input.error) return { label: 'Task needs attention', tone: 'error', detail: input.error };
  if (!input.selected && input.pending) return { label: 'Awaiting delivery confirmation', tone: 'warning', detail: 'Queued is not delivered. Do not send the same message again.' };
  if (!input.selected) return { label: 'Ready for a new conversation', tone: 'idle', detail: '' };
  if (!input.known) return { label: 'Checking task status…', tone: 'idle', detail: '' };
  if (input.stopping) return { label: 'Stop requested', tone: 'warning', detail: 'Waiting for ChatGPT to confirm. Your draft is preserved.' };
  if (input.blocked) return { label: 'Task needs attention', tone: 'warning', detail: 'Open task options to review the current restriction.' };
  if (input.error) return { label: 'Task needs attention', tone: 'error', detail: input.error };
  if (input.compacting) return { label: 'Preparing handoff', tone: 'busy', detail: 'Waiting for the recorded handoff result.' };
  if (input.waitingAtFinish) return { label: 'Waiting at turn finish', tone: 'warning', detail: '' };
  if (input.pending) return { label: 'Awaiting delivery confirmation', tone: 'warning', detail: 'Queued is not delivered. Do not send the same message again.' };
  if (input.active) return { label: 'Turn in progress', tone: 'busy', detail: 'Based on the latest recorded turn state.' };
  return { label: 'No active turn', tone: 'idle', detail: '' };
}
