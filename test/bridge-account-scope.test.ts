import { expect, it } from 'vitest';
import { accountRouteError, type BridgeAccountScope } from '../src/main/bridge-account-scope.js';
import type { InputEntry } from '../src/main/session/input.js';

const principal = { accountId: 'a', connectionVersion: 7 };
const entry = (id: string, accountId: string | undefined, patch: Partial<InputEntry> = {}): InputEntry => ({
  id, accountId, connectionVersion: 7, sessionId: accountId ? `s-${accountId}` : null, conversationId: accountId ? `c-${accountId}` : null,
  projectId: null, state: 'browser', owner: 'owner-a', text: '', mode: 'auto', dueAt: 1, createdAt: 1,
  model: null, reasoningEffort: null, ...patch
} as InputEntry);
const scope: BridgeAccountScope = {
  sessions: [{ id: 's-a', accountId: 'a', conversationId: 'c-a', projectId: 'p-a' },
    { id: 's-b', accountId: 'b', conversationId: 'c-b', projectId: 'p-b' },
    { id: 's-old', conversationId: 'c-old' }],
  inputs: [entry('i-a', 'a'), entry('i-b', 'b'), entry('i-old', undefined),
    entry('i-new', 'a', { sessionId: null, conversationId: null }),
    entry('i-stale', 'a', { connectionVersion: 6 }), entry('i-unknown-epoch', 'a', { connectionVersion: undefined })],
  stopCommands: [{ id: 'stop-a', conversationId: 'c-a' }, { id: 'stop-b', conversationId: 'c-b' }]
};
const check = (route: string, body: Record<string, unknown> = {}) => accountRouteError(principal, route, body, new URL(`http://127.0.0.1${route}`), scope);

it.each(['claim', 'bind', 'ack', 'answer', 'fail', 'progress', 'attachment'])('refuses %s of another account, unknown or legacy input', action => {
  for (const id of ['i-b', 'i-old', 'missing']) expect(check(`/input/${action}`, { id })).toBe('input_account_mismatch');
  expect(check(`/input/${action}`, { id: 'i-a' })).toBeNull();
  expect(check(`/input/${action}`, { id: 'i-a', conversationId: 'c-b' })).toBe('conversation_account_mismatch');
});

it.each(['/events', '/correlations', '/closed', '/activity'])('checks account ownership for %s before any observation or update', route => {
  expect(check(route, { conversationId: 'c-a' })).toBeNull();
  for (const conversationId of ['c-b', 'c-old', 'unknown']) expect(check(route, { conversationId })).toBe('conversation_account_mismatch');
  expect(check(route, { conversationId: 'c-a', agent: 'worker-b' })).toBe('account_helper_unavailable');
});

it('rejects forged account, epoch, project and session fields independently of a valid conversation', () => {
  expect(check('/events', { conversationId: 'c-a', accountId: 'b' })).toBe('account_mismatch');
  expect(check('/events', { conversationId: 'c-a', connectionVersion: 6 })).toBe('stale_account_connection');
  expect(check('/events', { conversationId: 'c-a', sessionId: 's-b' })).toBe('session_account_mismatch');
  expect(check('/events', { conversationId: 'c-a', projectId: 'p-b' })).toBe('project_account_mismatch');
  expect(check('/input/ack', { id: 'i-stale' })).toBe('stale_input_connection');
});

it('permits only the exact claimed new input to bind an unowned new conversation', () => {
  expect(check('/input/bind', { id: 'i-new', owner: 'owner-a', conversationId: 'new-chat' })).toBeNull();
  expect(check('/input/ack', { id: 'i-new', owner: 'owner-a', conversationId: 'new-chat' })).toBeNull();
  for (const route of ['/input/bind', '/input/ack']) {
    expect(check(route, { id: 'i-new', owner: 'wrong', conversationId: 'new-chat' })).toBe('conversation_account_mismatch');
    expect(check(route, { id: 'i-new', owner: 'owner-a', conversationId: 'c-b' })).toBe('conversation_account_mismatch');
    expect(check(route, { id: 'i-new', owner: 'owner-a', conversationId: 'c-old' })).toBe('conversation_account_mismatch');
  }
  expect(check('/input/claim', { id: 'i-new', owner: 'owner-a', conversationId: 'new-chat' })).toBe('conversation_account_mismatch');
});

it('denies an already-claimed input with no connection epoch', () => {
  expect(check('/input/ack', { id: 'i-unknown-epoch', conversationId: 'c-a' })).toBe('stale_input_connection');
});

it('cannot acknowledge another account stop command and defaults new routes to denied', () => {
  expect(check('/commands/ack', { id: 'stop-a' })).toBeNull();
  expect(check('/commands/ack', { id: 'stop-b' })).toBe('command_account_mismatch');
  expect(check('/commands/ack', { id: 'missing' })).toBe('command_account_mismatch');
  for (const route of ['/new-action', '/input/replay', '/agents/spawn', '/account/remove']) expect(check(route)).toBe('account_route_unavailable');
});
