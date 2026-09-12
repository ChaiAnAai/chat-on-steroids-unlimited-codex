import { access } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getSecret, setSecret } from './secrets.js';
import type { ProxyConnectionSettings, ProxyManagementRequest, ProxyManagementResult, ProxyManagementStatus } from '../shared/proxy-management.js';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8317';
const MAX_RESPONSE = 2 * 1024 * 1024;
export function normalizeProxyEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
    throw new Error('Enter the proxy server origin without credentials, a path or query parameters.');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    throw new Error('Remote proxy connections require HTTPS. Local connections may use HTTP.');
  return url.origin;
}
function secretKey(endpoint: string, kind: 'management' | 'api'): `plugin:${string}` {
  return `plugin:cliproxy:${createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}:${kind}`;
}
export async function discoverProxyExecutable(): Promise<string | null> {
  const names = process.platform === 'win32' ? ['cli-proxy-api.exe', 'CLIProxyAPI.exe'] : ['cli-proxy-api', 'CLIProxyAPI'];
  const roots = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA)
    roots.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  for (const root of new Set(roots)) for (const name of names) {
    const candidate = path.resolve(root, name);
    try { await access(candidate); return candidate; } catch { /* Detection does not run binaries. */ }
  }
  return null;
}
async function limitedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE) {
    await response.body?.cancel(); throw new Error('Proxy response is too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Proxy returned an empty response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE) throw new Error('Proxy response is too large.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Remote content gets a new ephemeral partition, no preload, and no app IPC authority. */
export async function openProxyConsole(endpoint: string): Promise<void> {
  const origin = normalizeProxyEndpoint(endpoint);
  const { BrowserWindow } = await import('electron');
  const window = new BrowserWindow({
    width: 1100, height: 800, minWidth: 700, minHeight: 500, show: false,
    title: 'CLIProxyAPI', autoHideMenuBar: true,
    webPreferences: { partition: `cliproxy-diagnostics-${randomUUID()}`, sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false }
  });
  const contents = window.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.on('will-download', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const outside = (target: string) => { try { return new URL(target).origin !== origin; } catch { return true; } };
  contents.on('will-navigate', (event, target) => { if (outside(target)) event.preventDefault(); });
  contents.on('will-redirect', (event, target) => { if (outside(target)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  // Diagnostics never receives saved credentials. Provider OAuth stays in the system browser.
  try { await window.loadURL(`${origin}/management.html`); window.show(); }
  catch { window.destroy(); throw new Error('The proxy management page could not be opened. Check the service and try again.'); }
}

export interface ProxyManagementDependencies {
  getSettings: () => ProxyConnectionSettings | undefined;
  saveSettings: (settings: ProxyConnectionSettings) => Promise<void>;
  fetch?: typeof fetch;
  discover?: () => Promise<string | null>;
  readSecret?: typeof getSecret;
  writeSecret?: typeof setSecret;
  openConsole?: typeof openProxyConsole;
}
/** Explicit user actions only: no startup polling, model calls, service launch or upstream writes. */
export function createProxyManagement(deps: ProxyManagementDependencies): (request: ProxyManagementRequest) => Promise<ProxyManagementResult> {
  const requestFetch = deps.fetch ?? fetch;
  const readSecret = deps.readSecret ?? getSecret;
  const writeSecret = deps.writeSecret ?? setSecret;
  let queue: Promise<unknown> = Promise.resolve();
  async function perform(request: ProxyManagementRequest): Promise<ProxyManagementResult> {
    if (!request || !['status', 'models', 'configure', 'open-console'].includes(request.action))
      return { ok: false, error: 'Unknown proxy management action.' };
    let settings = deps.getSettings();
    let endpoint: string;
    try { endpoint = normalizeProxyEndpoint(request.action === 'configure' ? request.endpoint : settings?.endpoint ?? DEFAULT_ENDPOINT); }
    catch { return { ok: false, error: 'Enter a valid proxy origin. Remote connections require HTTPS; local connections may use HTTP.' }; }
    if (request.action === 'configure') {
      if ((request.managementKey?.length ?? 0) > 8192 || (request.apiKey?.length ?? 0) > 8192)
        return { ok: false, error: 'The credential is too long.' };
      if (request.model !== undefined && (typeof request.model !== 'string' || request.model.length > 256))
        return { ok: false, error: 'Choose a valid model.' };
      // Credential custody commits first; failed config saves leave recoverable credentials,
      // never a visible configured connection whose credentials were not durably saved.
      if (request.managementKey !== undefined) await writeSecret(secretKey(endpoint, 'management'), request.managementKey.trim());
      if (request.apiKey !== undefined) await writeSecret(secretKey(endpoint, 'api'), request.apiKey.trim());
      settings = { endpoint, ...(request.model ? { model: request.model } : settings?.endpoint === endpoint && settings.model ? { model: settings.model } : {}) };
      await deps.saveSettings(settings);
    }
    const [managementKey, apiKey, executable] = await Promise.all([
      readSecret(secretKey(endpoint, 'management')), readSecret(secretKey(endpoint, 'api')), (deps.discover ?? discoverProxyExecutable)()
    ]);
    const status: ProxyManagementStatus = {
      endpoint, executable, managementCredentialSaved: !!managementKey, apiCredentialSaved: !!apiKey,
      connection: 'not-configured', version: null, compatible: null, model: settings?.model
    };
    if (request.action === 'open-console') {
      await (deps.openConsole ?? openProxyConsole)(endpoint); status.opened = true;
      return { ok: true, data: status };
    }
    // Saving is not a connectivity assertion and never submits unverified credentials.
    if (request.action === 'configure') return { ok: true, data: status };
    const credential = request.action === 'models' ? apiKey : managementKey;
    if (!credential) return { ok: true, data: status };
    let response: Response;
    try {
      response = await requestFetch(`${endpoint}${request.action === 'models' ? '/v1/models' : '/v0/management/config'}`, {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(8000)
      });
    } catch { status.connection = 'unreachable'; return { ok: true, data: status }; }
    status.version = response.headers.get('x-cpa-version')?.slice(0, 100) ?? null;
    status.connection = response.ok ? 'ready' : [401, 403].includes(response.status) ? 'unauthorized' : 'unavailable';
    // Probe the actual installed API instead of inferring compatibility from a version range.
    status.compatible = response.ok ? true : response.status === 404 ? false : null;
    if (request.action === 'models' && response.ok) {
      const data = await limitedJson(response) as { data?: { id?: unknown }[] };
      if (!Array.isArray(data?.data)) return { ok: false, error: 'The proxy model response is incompatible. Open diagnostics to inspect the service.' };
      status.models = [...new Set(data.data.flatMap(model => typeof model?.id === 'string' && model.id.length <= 256 ? [model.id] : []))].sort();
    } else await response.body?.cancel(); // Never read or return the management config (contains secrets).
    return { ok: true, data: status };
  }
  return request => {
    const result = queue.then(() => perform(request)).catch((): ProxyManagementResult => ({
      ok: false, error: 'The proxy operation failed. Your existing connection settings remain available; check secure storage or service availability and retry.'
    }));
    queue = result; return result;
  };
}
