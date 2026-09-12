import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { TrustedAccountPrincipal } from '../src/shared/accounts.js';
import { DEFAULT_CAPABILITIES } from '../src/shared/types.js';
import { startMcpServer, type McpEndpoint } from '../src/main/mcp/server.js';
import { createSession, bindSessionAccount, initSessionStore, flushSessions, resetSessionStoreForTests } from '../src/main/session/store.js';
import { observeRequestCorrelation } from '../src/main/session/correlation.js';
import { createRegistrar, dispatch } from '../src/main/mcp/kernel.js';
import { registerSessionTool } from '../src/main/mcp/session-tool.js';
import { currentCaller, emptyEvidence, type CallContext } from '../src/main/mcp/call-context.js';
import { inboundAccountPrincipal, withAccountPrincipal, accountToolDenial } from '../src/main/mcp/account-guard.js';
import { makeTempDir, removeTempDir } from './helpers.js';
import { currentAccountTransport } from '../src/main/account-context.js';

const registry = vi.hoisted(() => ({ current: true, tokens: new Map<string, TrustedAccountPrincipal>() }));
vi.mock('../src/main/accounts.js', () => ({
  isAccountPrincipalCurrent: async (principal: TrustedAccountPrincipal) => registry.current && principal.connectionVersion === 7,
  resolveMcpAccountToken: async (surface: string, token: string) => registry.current && surface === 'core' ? registry.tokens.get(token) ?? null : null
}));
const accountA: TrustedAccountPrincipal = { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', connectionVersion: 7, surface: 'core' };
const accountB: TrustedAccountPrincipal = { accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', connectionVersion: 7, surface: 'core' };
const token = 'a'.repeat(48);
let dir: string, endpoint: McpEndpoint, a: string, b: string, legacy: string;
const ctx = { roots: [], caps: { ...DEFAULT_CAPABILITIES }, readOnly: true, sessionTools: true, agentTools: false };
beforeAll(async () => {
  dir = await makeTempDir('mcp-account-'); initSessionStore(dir);
  const one = await createSession({ conversationId: 'conversation-a', title: 'A private project' }); a = one.id;
  const two = await createSession({ conversationId: 'conversation-b', title: 'B private project' }); b = two.id;
  legacy = (await createSession({ conversationId: 'conversation-legacy', title: 'Legacy project' })).id;
  await bindSessionAccount(a, accountA.accountId); await bindSessionAccount(b, accountB.accountId);
  registry.tokens.set(token, accountA);
  endpoint = await startMcpServer(() => ctx);
});
afterAll(async () => { await endpoint?.stop(); await flushSessions(); resetSessionStoreForTests(); await removeTempDir(dir); });

function parent(account: TrustedAccountPrincipal | null, sessionId = a, conversationId = 'conversation-a'): CallContext {
  return { startedAt: Date.now(), transportKey: null, agent: null, caller: { account, transportKey: null, requestId: null, sessionId, conversationId }, outcome: null, evidence: emptyEvidence() };
}
function text(result: { content: unknown[] }): string { return JSON.stringify(result.content); }
async function post(url: string, method: string, params: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return { status: response.status, text: await response.text() };
}

it('routes account-scoped secrets on the same listener and rejects the wrong surface and token', async () => {
  const origin = new URL(endpoint.url).origin;
  const valid = await post(`${origin}/mcp/core/${token}`, 'tools/list', {});
  expect(valid.status).toBe(200); expect(valid.text).toContain('session');
  expect((await post(`${origin}/mcp/desktop/${token}`, 'tools/list', {})).status).toBe(404);
  expect((await post(`${origin}/mcp/core/${'b'.repeat(48)}`, 'tools/list', {})).status).toBe(404);
});

it('does not accept account identity from a legacy request body or arbitrary request id', async () => {
  const response = await post(endpoint.urls.core, 'tools/call', { name: 'session', arguments: { action: 'read', session_id: b }, accountId: accountB.accountId });
  expect(response.text).toContain('ACCOUNT_OWNERSHIP_REQUIRED'); expect(response.text).not.toContain('B private project');
  const unknown = await post(`${new URL(endpoint.url).origin}/mcp/core/${token}`, 'tools/call', { name: 'session', arguments: { action: 'search' } });
  expect(unknown.text).toContain('ACCOUNT_OWNERSHIP_REQUIRED');
});

it('carries the authenticated HTTP principal into a proven tool call and rejects another account request proof', async () => {
  const requestId = 'wfr_account_http_a';
  observeRequestCorrelation({ requestId, conversationId: 'conversation-a', sessionId: a, messageId: 'message-account-a', tool: 'session', observedAt: Date.now() });
  const url = `${new URL(endpoint.url).origin}/mcp/core/${token}`;
  const allowed = await post(url, 'tools/call', { name: 'session', arguments: { action: 'search' } }, { 'x-request-id': requestId });
  expect(allowed.text).toContain('A private project'); expect(allowed.text).not.toContain('B private project');
  const otherRequest = 'wfr_account_http_b';
  observeRequestCorrelation({ requestId: otherRequest, conversationId: 'conversation-b', sessionId: b, messageId: 'message-account-b', tool: 'session', observedAt: Date.now() });
  const denied = await post(url, 'tools/call', { name: 'session', arguments: { action: 'read', session_id: b } }, { 'x-request-id': otherRequest });
  expect(denied.text).toContain('ACCOUNT_OWNERSHIP_REQUIRED'); expect(denied.text).not.toContain('B private project');
});

it('isolates parallel ingress principals and code-mode child contexts', async () => {
  const seen = await Promise.all([accountA, accountB].map(account => withAccountPrincipal(account, async () => {
    await Promise.resolve();
    expect(currentAccountTransport()).toMatchObject({ accountId: account.accountId, connectionVersion: account.connectionVersion });
    withAccountPrincipal(null, () => {
      expect(inboundAccountPrincipal()).toBeNull();
      expect(currentAccountTransport()).toBeUndefined();
    });
    expect(currentAccountTransport()?.accountId).toBe(account.accountId);
    return inboundAccountPrincipal()?.accountId;
  })));
  expect(seen).toEqual([accountA.accountId, accountB.accountId]); expect(inboundAccountPrincipal()).toBeNull();
  expect(currentAccountTransport()).toBeUndefined();
  const nested = await dispatch('read', {}, null, null, 'core', async () => ({ content: [{ type: 'text', text: currentCaller().account?.accountId ?? 'missing' }] }), parent(accountA));
  expect(text(nested)).toContain(accountA.accountId);
  const handler = vi.fn(async () => ({ content: [] }));
  const denied = await dispatch('update_plan', { plan: [] }, null, null, 'core', handler, parent(accountB));
  expect(text(denied)).toContain('ACCOUNT_OWNERSHIP_REQUIRED'); expect(handler).not.toHaveBeenCalled();
});

it('filters session discovery before reading content and refuses explicit cross-account reads', async () => {
  const registrar = createRegistrar(null, ctx, 'core'); registerSessionTool(registrar);
  const results = await registrar.invokeNested('session', { action: 'search' }, parent(accountA));
  expect(text(results)).toContain('A private project'); expect(text(results)).not.toContain('B private project'); expect(text(results)).not.toContain('Legacy project');
  const denied = await registrar.invokeNested('session', { action: 'read', session_id: b }, parent(accountA));
  expect(text(denied)).toContain('ACCOUNT_OWNERSHIP_REQUIRED');
  const old = await registrar.invokeNested('session', { action: 'search' }, parent(null, legacy, 'conversation-legacy'));
  expect(text(old)).toContain('Legacy project'); expect(text(old)).not.toContain('private project');
});

it('rejects stale identity and mismatched conversation ownership before checkpoint handlers', async () => {
  const handler = vi.fn(async () => ({ content: [] }));
  for (const caller of [parent({ ...accountA, connectionVersion: 6 }), parent(accountA, a, 'conversation-b'), parent(null)]) {
    const result = await dispatch('session', { action: 'checkpoint', checkpoint: {} }, null, null, 'core', handler, caller);
    expect(text(result)).toContain('ACCOUNT_OWNERSHIP_REQUIRED');
  }
  expect(handler).not.toHaveBeenCalled();
});

it('withholds a result if its account is revoked while the handler awaits without inviting mutation replay', async () => {
  let finish!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const pending = dispatch('read', {}, null, null, 'core', async () => { started(); await new Promise<void>(resolve => { finish = resolve; }); return { content: [{ type: 'text', text: 'private content' }] }; }, parent(accountA));
  await entered; registry.current = false; finish();
  const result = await pending; registry.current = true;
  expect(text(result)).toContain('ACCOUNT_CONNECTION_CHANGED'); expect(text(result)).not.toContain('private content');
});

it('fails closed if the ownership store cannot be read', async () => {
  const denial = await accountToolDenial(accountA, { sessionId: a, conversationId: 'conversation-a' }, 'read', {}, {
    current: async () => true, session: async () => { throw new Error('offline'); }, conversation: async () => null, sessions: async () => []
  });
  expect(denial).toContain('ACCOUNT_OWNERSHIP_REQUIRED');
});
