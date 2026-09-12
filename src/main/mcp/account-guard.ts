import { AsyncLocalStorage } from 'node:async_hooks';
import type { TrustedAccountPrincipal } from '../../shared/accounts.js';
import type { SessionSummary } from '../../shared/session.js';
import { isAccountPrincipalCurrent } from '../accounts.js';
import { withAccountTransport } from '../account-context.js';
import { findSessionByConversation, getSession, indexedSessions } from '../session/store.js';

/** Populated only by the authenticated HTTP route, never by MCP arguments or headers. */
const ingress = new AsyncLocalStorage<TrustedAccountPrincipal | null>();
export function withAccountPrincipal<T>(principal: TrustedAccountPrincipal | null, run: () => T): T {
  const trusted = principal ? Object.freeze({ ...principal }) : null;
  return ingress.run(trusted, () => withAccountTransport(trusted ?? undefined, run));
}
export function inboundAccountPrincipal(): TrustedAccountPrincipal | null { return ingress.getStore() ?? null; }

export function sessionOwnedByAccount(session: Pick<SessionSummary, 'accountId'>, principal: TrustedAccountPrincipal | null): boolean {
  return principal ? session.accountId === principal.accountId : !session.accountId;
}

export interface AccountGuardCaller {
  conversationId: string | null;
  sessionId?: string | null;
}
export interface AccountGuardDependencies {
  current: (principal: TrustedAccountPrincipal) => Promise<boolean>;
  session: typeof getSession;
  conversation: typeof findSessionByConversation;
  sessions: typeof indexedSessions;
}
const dependencies: AccountGuardDependencies = {
  current: isAccountPrincipalCurrent, session: getSession, conversation: findSessionByConversation, sessions: indexedSessions
};
const DENIED = 'ACCOUNT_OWNERSHIP_REQUIRED: this request is not authorized for the recorded account and session. No tool was run.';

/** Caller and explicit read target are separate checks; knowing an id is never permission. */
export async function accountToolDenial(
  principal: TrustedAccountPrincipal | null,
  caller: AccountGuardCaller,
  tool: string,
  args: unknown,
  deps: AccountGuardDependencies = dependencies
): Promise<string | null> {
  try {
    if (principal && !await deps.current(principal)) return DENIED;
    const byId = caller.sessionId ? await deps.session(caller.sessionId) : null;
    const byConversation = caller.conversationId ? await deps.conversation(caller.conversationId, { includeHistorical: true, requireUnique: true }) : null;
    if (principal && (!byId || !caller.sessionId || !caller.conversationId)) return DENIED;
    // A request-id collision must not let an account token adopt another conversation.
    if (byId && byConversation && byId.id !== byConversation.id) return DENIED;
    if (principal && (!byConversation || byId?.conversationId !== caller.conversationId)) return DENIED;
    for (const session of [byId, byConversation]) if (session && !sessionOwnedByAccount(session, principal)) return DENIED;
    if (!principal && !byId && !byConversation && (await deps.sessions()).some(session => !!session.accountId)) return DENIED;
    const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    if (tool === 'session' && input.action === 'read' && typeof input.session_id === 'string') {
      const target = await deps.session(input.session_id);
      if (!target || !sessionOwnedByAccount(target, principal)) return DENIED;
    }
    // The legacy worker broker lists and routes global families. Until its own account
    // ownership is implemented, do not let it become a cross-account enumeration route.
    if (tool === 'agents' && (principal || (await deps.sessions()).some(session => !!session.accountId)))
      return 'ACCOUNT_AGENT_ROUTING_UNAVAILABLE: account-scoped worker routing is not available. Continue in the current conversation.';
    return null;
  } catch { return DENIED; }
}

/** A second check at a read/publication boundary catches revocation while a read awaited IO. */
export async function accountPrincipalCurrent(principal: TrustedAccountPrincipal | null): Promise<boolean> {
  if (!principal) return true;
  try { return await isAccountPrincipalCurrent(principal); } catch { return false; }
}
