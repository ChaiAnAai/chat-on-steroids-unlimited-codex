import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/main/secrets.js', () => ({ getSecret: vi.fn(), setSecret: vi.fn() }));
import { createProxyManagement, normalizeProxyEndpoint } from '../src/main/proxy-management.js';
import type { ProxyConnectionSettings } from '../src/shared/proxy-management.js';

function setup() {
  let settings: ProxyConnectionSettings | undefined;
  const secrets = new Map<string, string>();
  const fetcher = vi.fn<typeof fetch>();
  const saveSettings = vi.fn(async (value: ProxyConnectionSettings) => { settings = value; });
  const openConsole = vi.fn(async () => undefined);
  const handle = createProxyManagement({ getSettings: () => settings, saveSettings, fetch: fetcher,
    discover: async () => 'C:\\Tools\\cli-proxy-api.exe',
    readSecret: async key => secrets.get(key) ?? null,
    writeSecret: async (key, value) => { secrets.set(key, value); }, openConsole });
  return { handle, secrets, fetcher, saveSettings, openConsole };
}
const credentials = { action: 'configure' as const, endpoint: 'http://127.0.0.1:8317', managementKey: 'private-management', apiKey: 'private-api' };

describe('explicit proxy connection management', () => {
  it('detects installation without making unauthenticated probes that could trigger a ban', async () => {
    const { handle, fetcher } = setup(); const response = await handle({ action: 'status' });
    expect(response.ok && response.data.connection).toBe('not-configured'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('saves only metadata to config, keeps credentials in main and never tests on save', async () => {
    const { handle, secrets, fetcher, saveSettings } = setup();
    const result = await handle(credentials);
    expect(result.ok).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith({ endpoint: credentials.endpoint });
    expect([...secrets.values()]).toEqual(['private-management', 'private-api']);
    expect(JSON.stringify(result)).not.toContain('private-'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('binds saved credentials to the configured origin, never reuses them at another server', async () => {
    const { handle, fetcher } = setup(); await handle(credentials);
    await handle({ action: 'configure', endpoint: 'https://other.example' });
    const result = await handle({ action: 'status' });
    expect(result.ok && result.data.managementCredentialSaved).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps rejected credentials explicit without automatic retries or reading config secrets', async () => {
    const { handle, fetcher } = setup(); await handle(credentials);
    const response = new Response('{"secret":"never-read"}', { status: 403, headers: { 'x-cpa-version': '6.8.1' } });
    const text = vi.spyOn(response, 'text'); const json = vi.spyOn(response, 'json'); fetcher.mockResolvedValue(response);
    const result = await handle({ action: 'status' });
    expect(result.ok && result.data.connection).toBe('unauthorized'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('never-read');
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
  it('uses the separate API credential for bounded model discovery and deduplicates identifiers', async () => {
    const { handle, fetcher } = setup(); await handle(credentials);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: 9 }] })));
    const result = await handle({ action: 'models' }); expect(result.ok && result.data.models).toEqual(['a', 'b']);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${credentials.endpoint}/v1/models`);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: 'Bearer private-api' });
  });
  it('reports incompatible APIs and transport failures distinctly', async () => {
    const { handle, fetcher } = setup(); await handle(credentials);
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    const badApi = await handle({ action: 'status' }); expect(badApi.ok && badApi.data.compatible).toBe(false);
    fetcher.mockRejectedValueOnce(new Error('private-management internal URL'));
    const offline = await handle({ action: 'status' }); expect(offline.ok && offline.data.connection).toBe('unreachable');
    expect(JSON.stringify(offline)).not.toContain('private-management');
  });
  it('never exposes raw service errors and rejects oversized model responses', async () => {
    const { handle, fetcher } = setup(); await handle(credentials);
    fetcher.mockResolvedValue(new Response('private-api', { headers: { 'content-length': '3000000' } }));
    const result = await handle({ action: 'models' }); expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-api');
  });
  it('opens only the selected diagnostic origin and does not hand it saved credentials', async () => {
    const { handle, openConsole, fetcher } = setup(); await handle(credentials);
    await handle({ action: 'open-console' });
    expect(openConsole).toHaveBeenCalledExactlyOnceWith(credentials.endpoint); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['http://remote.example', 'file:///c:/secret', 'javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/v1', 'https://example.com/?key=secret'])('rejects an unsafe or ambiguous origin %s', endpoint => {
    expect(() => normalizeProxyEndpoint(endpoint)).toThrow();
  });
  it('serializes saves so a stale request cannot restore an older endpoint', async () => {
    const { handle, saveSettings } = setup();
    await Promise.all([handle(credentials), handle({ action: 'configure', endpoint: 'https://other.example', model: 'm' })]);
    expect(saveSettings.mock.calls.map(call => call[0].endpoint)).toEqual([credentials.endpoint, 'https://other.example']);
    const result = await handle({ action: 'status' }); expect(result.ok && result.data.endpoint).toBe('https://other.example');
  });
});
