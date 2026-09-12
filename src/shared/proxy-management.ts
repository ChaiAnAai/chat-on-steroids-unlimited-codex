/** Credentials only travel renderer → main on explicit save; replies never contain secrets. */
export interface ProxyConnectionSettings { endpoint: string; model?: string }
export type ProxyManagementRequest =
  | { action: 'status' | 'models' | 'open-console' }
  | { action: 'configure'; endpoint: string; managementKey?: string; apiKey?: string; model?: string };
export interface ProxyManagementStatus {
  endpoint: string;
  executable: string | null;
  managementCredentialSaved: boolean;
  apiCredentialSaved: boolean;
  connection: 'not-configured' | 'unreachable' | 'unauthorized' | 'unavailable' | 'ready';
  version: string | null;
  compatible: boolean | null;
  models?: string[];
  model?: string;
  opened?: boolean;
}
export type ProxyManagementResult = { ok: true; data: ProxyManagementStatus } | { ok: false; error: string };
