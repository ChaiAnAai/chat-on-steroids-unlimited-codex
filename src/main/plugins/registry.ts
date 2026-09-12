import { z } from 'zod';
import { isIP } from 'node:net';
import { fetchRegistryIcon } from './registry-icon.js';
import type { PluginField, PluginInstallRequest, PluginRegistryEntry, PluginRegistryOption, PluginRegistryPage, PluginRegistryQuery, PluginSource } from '../../shared/plugins.js';

const BASE = 'https://registry.modelcontextprotocol.io/v0.1/servers';
const name = z.string().min(3).max(256).regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/-]+$/);
export const registryReference = z.object({ name, version: z.string().min(1).max(128), optionId: z.string().regex(/^(remote|package):\d{1,2}$/), authentication: z.enum(['none','oauth']).optional() }).strict();
export const registryQuery = z.object({ search: z.string().trim().max(160).optional(), cursor: z.string().max(1024).optional() }).strict();
export const registryIconQuery = registryReference.pick({name:true,version:true}).strict();
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 2000): string => typeof v === 'string' ? v.slice(0, max) : '';
const list = (v: unknown): unknown[] => Array.isArray(v) ? v.slice(0, 32) : [];
const fieldName = /^[a-zA-Z_][a-zA-Z0-9_-]{0,100}$/;
const exactVersion = /^\d+(\.\d+)+([a-z0-9.+_-]*)$/i;
const packageName = /^(@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i;

/** Directory metadata never grants local-network access or supplies executable shell text. */
function publicUrl(value: unknown): string | undefined {
  try {
    const raw = text(value, 4096); if (!raw || /[{}]/.test(raw)) return;
    const url = new URL(raw), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !host.includes('.') ||
        isIP(host.replace(/^\[|\]$/g,'')) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return;
    return url.href;
  } catch { return; }
}

function fields(value: unknown, remote: boolean): { fields: PluginField[]; defaults: Record<string,string> } {
  if (value !== undefined && (!Array.isArray(value) || value.length > 32)) throw Error('Complex configuration needs manual setup');
  const result: PluginField[] = [], defaults: Record<string,string> = {};
  for (const raw of list(value)) {
    const v = record(raw), key = text(v.name,128);
    if (!fieldName.test(key) || ['__proto__','constructor','prototype'].includes(key) || result.some(f => f.key.toLowerCase() === key.toLowerCase())) throw Error('Unsupported configuration field');
    if (remote && /^(host|cookie|set-cookie|content-length|connection|transfer-encoding|proxy-authorization)$/i.test(key)) throw Error('Unsupported HTTP header');
    const supplied = text(v.value,4096), fallback = text(v.default,4096);
    // A single trailing placeholder supports standard "Bearer {api_key}" headers.
    const template = /^([^{}]*)\{[a-zA-Z0-9_-]+\}$/.exec(supplied);
    if ((/[{}]/.test(supplied) && !template) || /[\r\n\0]/.test(supplied + fallback)) throw Error('Complex configuration needs manual setup');
    const secret = remote || v.isSecret === true || /token|password|secret|api.?key|authorization/i.test(key);
    const prefix = template?.[1] || undefined;
    if (prefix && !secret) throw Error('Complex configuration needs manual setup');
    result.push({ key, label: key, secret, required: v.isRequired === true,
      placeholder: text(v.description,500) || key, ...(prefix ? {valuePrefix:prefix} : {}) });
    // Public non-secret defaults only; never carry registry credentials into an installation.
    if (!secret && !template && (supplied || fallback)) defaults[key] = supplied || fallback;
  }
  return { fields: result, defaults };
}

/** Convert declarative install metadata to the existing installer contract, fail per option. */
export function parseRegistryEntry(raw: unknown): PluginRegistryEntry | null {
  const envelope = record(raw), s = record(envelope.server);
  if (!name.safeParse(s.name).success || typeof s.version !== 'string' || !s.version || s.version.length >128) return null;
  const status = record(record(envelope._meta)['io.modelcontextprotocol.registry/official']).status;
  if (status === 'deleted') return null;
  const entry: PluginRegistryEntry = { name:s.name as string, version:s.version, title:text(s.title,100) || text(String(s.name).split('/').at(-1),100).replace(/[-_]+/g,' '),
    description:text(s.description), homepage:publicUrl(s.websiteUrl) ?? publicUrl(record(s.repository).url), repository:publicUrl(record(s.repository).url), options:[], unsupported:[] };
  const origins = [entry.homepage,entry.repository,...list(s.remotes).map(r=>publicUrl(record(r).url))].filter((s):s is string=>!!s).map(s=>new URL(s).origin);
  entry.icons = list(s.icons).flatMap(raw=>{
    const icon=record(raw),src=publicUrl(icon.src);if(!src)return [];
    const url=new URL(src);
    if(url.port && url.port!=='443' || !origins.includes(url.origin) && !['avatars.githubusercontent.com','raw.githubusercontent.com','static.smithery.ai'].includes(url.hostname))return [];
    if(icon.mimeType && !['image/png','image/jpeg','image/jpg','image/webp'].includes(String(icon.mimeType)))return [];
    return [{src,...(icon.theme==='light'||icon.theme==='dark'?{theme:icon.theme}:{})}];
  }).slice(0,4) as NonNullable<PluginRegistryEntry['icons']>;
  if (status !== 'active') { entry.unsupported.push('This listing is not active'); return entry; }
  list(s.remotes).forEach((raw, index) => {
    const remote = record(raw);
    try {
      const url = publicUrl(remote.url);
      if (remote.type !== 'streamable-http' || !url) throw Error('This endpoint needs manual setup');
      entry.options.push({id:`remote:${index}`,source:{kind:'remote',url},...fields(remote.headers,true)});
    } catch (e) { entry.unsupported.push((e as Error).message); }
  });
  list(s.packages).forEach((raw,index) => {
    const p = record(raw);
    try {
      if (!['npm','pypi'].includes(String(p.registryType)) || record(p.transport).type !== 'stdio' ||
          !packageName.test(String(p.identifier)) || !exactVersion.test(String(p.version)) ||
          (p.registryType === 'pypi' && String(p.identifier).includes('/')) ||
          (p.runtimeArguments !== undefined && (!Array.isArray(p.runtimeArguments) || p.runtimeArguments.length)) ||
          (p.packageArguments !== undefined && (!Array.isArray(p.packageArguments) || p.packageArguments.length>32)) ||
          (p.runtimeHint !== undefined && p.runtimeHint !== (p.registryType === 'npm' ? 'npx' : 'uvx')) ||
          (p.registryBaseUrl && !['https://registry.npmjs.org','https://registry.npmjs.org/','https://pypi.org','https://pypi.org/'].includes(String(p.registryBaseUrl))))
        throw Error('This package needs manual setup');
      const args: string[] = [];
      for (const rawArg of list(p.packageArguments)) {
        const arg = record(rawArg), value = text(arg.value,4096);
        if (!['named','positional'].includes(String(arg.type)) || !value || /[{}\0]/.test(value) || arg.isRepeated || arg.variables) throw Error('Interactive arguments need manual setup');
        if (arg.type === 'named') {
          if (!/^--?[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(String(arg.name))) throw Error('Unsupported argument name');
          args.push(String(arg.name));
        }
        args.push(value);
      }
      const source: PluginSource = {kind:p.registryType === 'npm' ? 'npm':'python',package:String(p.identifier),version:String(p.version),args};
      entry.options.push({id:`package:${index}`,source,...fields(p.environmentVariables,false)});
    } catch (e) { entry.unsupported.push((e as Error).message); }
  });
  if (!entry.options.length && !entry.unsupported.length) entry.unsupported.push('No supported installation metadata');
  return entry;
}

/** Read-only bounded upstream access. Searching never connects to or executes a listed server. */
export class PluginRegistry {
  private cache = new Map<string,{expires:number;page:PluginRegistryPage}>();
  private pending = new Map<string,Promise<PluginRegistryPage>>();
  private icons = new Map<string,{expires:number;data:{dataUrl:string;theme?:'light'|'dark'}|null}>();
  private iconRequests = new Map<string,Promise<{dataUrl:string;theme?:'light'|'dark'}|null>>();
  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async icon(input:{name:string;version:string}):Promise<{dataUrl:string;theme?:'light'|'dark'}|null> {
    const ref=registryIconQuery.parse(input),key=`${ref.name}@${ref.version}`;
    const cached=this.icons.get(key);if(cached && cached.expires>Date.now())return cached.data;
    if(this.iconRequests.has(key))return this.iconRequests.get(key)!;
    if(this.iconRequests.size>=4)return null;
    const work=(async()=>{
      let entry:PluginRegistryEntry|null|undefined;
      for(const cached of this.cache.values()) if(cached.expires>Date.now()) {entry=cached.page.entries.find(e=>e.name===ref.name&&e.version===ref.version);if(entry)break;}
      entry ??= parseRegistryEntry(await this.json(`${BASE}/${encodeURIComponent(ref.name)}/versions/${encodeURIComponent(ref.version)}`));
      if(!entry || entry.name!==ref.name || entry.version!==ref.version)return null;
      const icon=entry.icons?.find(i=>!i.theme)??entry.icons?.find(i=>i.theme==='light')??entry.icons?.[0];
      const data=icon?{dataUrl:await fetchRegistryIcon(icon.src),theme:icon.theme}:null;
      if(this.icons.size>=128)this.icons.delete(this.icons.keys().next().value!);
      this.icons.set(key,{expires:Date.now()+3600000,data});return data;
    })().catch(()=>null).finally(()=>this.iconRequests.delete(key));
    this.iconRequests.set(key,work);return work;
  }
  private async json(url: string): Promise<unknown> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),12000);
    try {
      const response = await this.fetcher(url,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}});
      if (!response.ok) throw Error(response.status === 429 ? 'MCP directory is busy. Try again later.' : `MCP directory request failed (${response.status}).`);
      if (!response.body) throw Error('MCP directory returned an empty response.');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes=0;
      try { for (;;) { const {done,value} = await reader.read(); if(done) break; bytes+=value.byteLength; if(bytes>2*1024*1024) throw Error('MCP directory response is too large.'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (controller.signal.aborted) throw Error('MCP directory timed out. Try again.');
      if (error instanceof SyntaxError) throw Error('MCP directory returned an incompatible response.');
      throw error;
    } finally {clearTimeout(timer);}
  }
  search(input: PluginRegistryQuery = {}): Promise<PluginRegistryPage> {
    const query = registryQuery.parse(input), params = new URLSearchParams({limit:'24',version:'latest'});
    if(query.search) params.set('search',query.search);
    if(query.cursor) params.set('cursor',query.cursor);
    const key=params.toString(), cached=this.cache.get(key);
    if(cached && cached.expires>Date.now()) return Promise.resolve(structuredClone(cached.page));
    if(this.pending.has(key)) return this.pending.get(key)!;
    if(this.pending.size>=4) return Promise.reject(Error('MCP directory is busy. Try again later.'));
    const work=(async()=>{
      const data=record(await this.json(`${BASE}?${key}`));
      if(!Array.isArray(data.servers) || data.servers.length>100) throw Error('MCP directory returned an incompatible response.');
      const page: PluginRegistryPage={entries:data.servers.map(parseRegistryEntry).filter((e): e is PluginRegistryEntry=>!!e),fetchedAt:Date.now()};
      const cursor=record(data.metadata).nextCursor;
      if(typeof cursor==='string' && cursor.length<=1024 && cursor!==query.cursor) page.nextCursor=cursor;
      if(this.cache.size>=32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,{expires:Date.now()+3600000,page:structuredClone(page)});
      return page;
    })().finally(()=>this.pending.delete(key));
    this.pending.set(key,work); return work;
  }
  async resolve(request: PluginInstallRequest): Promise<{ entry:PluginRegistryEntry; option:PluginRegistryOption; source:PluginSource; config:Record<string,string>; credentials:Record<string,string> }> {
    const ref=registryReference.parse(request.registry);
    if(request.source || request.catalogId || request.name) throw Error('Registry installation cannot override its source.');
    const entry=parseRegistryEntry(await this.json(`${BASE}/${encodeURIComponent(ref.name)}/versions/${encodeURIComponent(ref.version)}`));
    const option=entry?.options.find(o=>o.id===ref.optionId);
    if(!entry || entry.name!==ref.name || entry.version!==ref.version || !option) throw Error('This listing changed or is unavailable. Search again before installing.');
    const source=structuredClone(option.source), config={...option.defaults,...request.config}, credentials={...request.credentials};
    if(ref.authentication==='oauth') {
      if(source.kind!=='remote' || option.fields.length) throw Error('This listing requires its declared credentials instead of browser sign-in.');
      source.auth='oauth';
    }
    for(const [values,secret] of [[config,false],[credentials,true]] as const)
      for(const key of Object.keys(values)) if(!option.fields.some(f=>f.key===key && !!f.secret===secret)) throw Error('Unexpected registry configuration field.');
    for(const field of option.fields) if(field.required && !(field.secret?credentials:config)[field.key]?.trim()) throw Error(`Missing required field: ${field.key}`);
    return {entry,option,source,config,credentials};
  }
}
export const pluginRegistry = new PluginRegistry();
