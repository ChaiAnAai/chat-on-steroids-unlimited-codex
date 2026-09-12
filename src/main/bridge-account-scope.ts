import type { AccountTransportPrincipal } from './account-context.js';
import type { InputEntry } from './session/input.js';
import type { SessionSummary } from '../shared/session.js';

export interface BridgeAccountScope {
  sessions: readonly Pick<SessionSummary, 'id' | 'accountId' | 'conversationId' | 'projectId'>[];
  inputs: readonly InputEntry[];
  stopCommands: readonly { id: string; conversationId: string }[];
}
/** Closed route inventory: new bridge operations require an explicit ownership review. */
export function accountRouteError(principal: AccountTransportPrincipal, route: string,
  body: Record<string, unknown>, url: URL, scope: BridgeAccountScope): string | null {
  if (body.accountId !== undefined && body.accountId !== principal.accountId) return 'account_mismatch';
  if (body.connectionVersion !== undefined && body.connectionVersion !== principal.connectionVersion) return 'stale_account_connection';
  const ownsConversation = (value: unknown) => typeof value === 'string' && scope.sessions.some(row =>
    row.accountId === principal.accountId && row.conversationId === value);
  if (body.sessionId !== undefined && !scope.sessions.some(row => row.id === body.sessionId && row.accountId === principal.accountId)) return 'session_account_mismatch';
  if (body.projectId !== undefined && !scope.sessions.some(row => row.projectId === body.projectId && row.accountId === principal.accountId)) return 'project_account_mismatch';
  if (route === '/status' || route === '/usage' || route === '/models') return null;
  if (route.startsWith('/input/')) {
    if (!['claim', 'bind', 'ack', 'answer', 'fail', 'progress', 'attachment'].some(action => route === `/input/${action}`)) return 'account_route_unavailable';
    const input = scope.inputs.find(row => row.id === body.id);
    if (!input || input.accountId !== principal.accountId) return 'input_account_mismatch';
    if (input.state !== 'queued' && input.connectionVersion === undefined) return 'stale_input_connection';
    if (input.connectionVersion !== undefined && input.connectionVersion !== principal.connectionVersion) return 'stale_input_connection';
    // Only a never-bound new-chat claim may acquire a new conversation. Existing history
    // is never reassigned by guessing an id in the request body.
    const target = body.conversationId;
    if (target && !ownsConversation(target)) {
      const alreadyOwned = scope.sessions.some(row => row.conversationId === target);
      if (alreadyOwned || input.sessionId || input.deliveredSessionId ||
        (input.conversationId && input.conversationId !== target) ||
        !['/input/bind', '/input/ack'].includes(route) || input.owner !== body.owner || input.state !== 'browser') return 'conversation_account_mismatch';
    }
    return null;
  }
  if (['/events', '/correlations', '/closed', '/activity'].includes(route)) {
    if (body.agent || body.agentCommandId) return 'account_helper_unavailable';
    return ownsConversation(body.conversationId ?? url.searchParams.get('conversationId')) ? null : 'conversation_account_mismatch';
  }
  if (route === '/commands/ack') {
    const command = scope.stopCommands.find(row => row.id === body.id);
    return command && ownsConversation(command.conversationId) ? null : 'command_account_mismatch';
  }
  return 'account_route_unavailable';
}
