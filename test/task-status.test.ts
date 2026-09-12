import { describe, expect, it } from 'vitest';
import { taskStatus, type TaskStatusInput } from '../src/renderer/task-status.js';
const idle: TaskStatusInput = { selected: true, known: true, active: false, stopping: false, blocked: false, compacting: false, pending: false, waitingAtFinish: false };
describe('task state projection', () => {
  it('never implies work from idle or unknown controls', () => {
    expect(taskStatus(idle).label).toBe('No active turn');
    expect(taskStatus({ ...idle, known: false, active: true }).tone).toBe('idle');
  });
  it('shows pending New Chat delivery rather than ready', () => {
    expect(taskStatus({ ...idle, selected: false, pending: true }).label).toBe('Awaiting delivery confirmation');
  });
  it('prioritizes stop acknowledgement, delivery errors and handoff errors over active work', () => {
    expect(taskStatus({ ...idle, active: true, stopping: true }).label).toBe('Stop requested');
    expect(taskStatus({ ...idle, active: true, error: 'Delivery uncertain' })).toMatchObject({ tone: 'error', detail: 'Delivery uncertain' });
    expect(taskStatus({ ...idle, compacting: true, error: 'Handoff failed' }).tone).toBe('error');
    expect(taskStatus({ ...idle, active: true }).tone).toBe('busy');
  });
});
