import { AsyncLocalStorage } from 'node:async_hooks';

/** Set by authenticated transports, never by a tool or page request body. */
export interface AccountTransportPrincipal {
  accountId: string;
  connectionVersion: number;
}
const context = new AsyncLocalStorage<AccountTransportPrincipal | undefined>();
export const currentAccountTransport = (): AccountTransportPrincipal | undefined => context.getStore();
export function withAccountTransport<T>(principal: AccountTransportPrincipal | undefined, run: () => T): T {
  return context.run(principal, run);
}
