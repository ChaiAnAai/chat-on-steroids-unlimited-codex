import { describe,expect,it,vi } from 'vitest';
import { PluginRegistry,parseRegistryEntry } from '../src/main/plugins/registry.js';
const envelope=(server:Record<string,unknown>={},status='active')=>({server:{name:'org.example/docs',title:'Example',description:'Public documentation',version:'1.0.0',remotes:[{type:'streamable-http',url:'https://docs.example.com/mcp'}],...server},_meta:{'io.modelcontextprotocol.registry/official':{status}}});
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
describe('public MCP registry adapter',()=>{
  it('uses the official API with encoded search and cursor, caches successful pages and never contacts a listed endpoint',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>json({servers:[envelope()],metadata:{nextCursor:'org.example/docs:1'}}));
    const registry=new PluginRegistry(fetcher),request={search:'docs & tools',cursor:'previous:1 /'};
    const first=await registry.search(request);first.entries[0]!.title='Changed by caller';
    const second=await registry.search(request);expect(second.entries[0]!.title).toBe('Example');expect(fetcher).toHaveBeenCalledTimes(1);
    const url=new URL(String(fetcher.mock.calls[0]![0]));expect(url.origin).toBe('https://registry.modelcontextprotocol.io');expect(url.searchParams.get('search')).toBe(request.search);expect(url.searchParams.get('cursor')).toBe(request.cursor);
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe('error');
  });
  it('coalesces concurrent searches, but retries failures',async()=>{
    let done!:(r:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{done=resolve;}));
    const registry=new PluginRegistry(fetcher);const a=registry.search(),b=registry.search();done(json({servers:[]}));await Promise.all([a,b]);expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(json({servers:[]}));
    await expect(registry.search({search:'new'})).rejects.toThrow('busy');await expect(registry.search({search:'new'})).resolves.toMatchObject({entries:[]});
  });
  it('keeps provenance, creates secret header fields and identifies templates requiring manual configuration',()=>{
    const entry=parseRegistryEntry(envelope({remotes:[{type:'streamable-http',url:'https://server.smithery.ai/demo/mcp',headers:[{name:'Authorization',value:'Bearer {key}',isRequired:true}]}]}))!;
    expect(entry.options[0]!.fields).toEqual([expect.objectContaining({key:'Authorization',secret:true,required:true,valuePrefix:'Bearer '})]);
    expect(entry.options[0]!.defaults).toEqual({});
    for(const url of ['http://example.com/mcp','https://127.0.0.1/mcp','https://user:pass@example.com/mcp','https://server.local/mcp','https://{tenant}.example.com/mcp'])expect(parseRegistryEntry(envelope({remotes:[{type:'streamable-http',url}]}))!.options).toEqual([]);
    expect(parseRegistryEntry(envelope({},'deleted'))).toBeNull();expect(parseRegistryEntry(envelope({},'deprecated'))!.options).toEqual([]);
  });
  it('uses exact package versions and static arguments; required secrets never become plain config defaults',()=>{
    const p={registryType:'npm',identifier:'@example/server',version:'2.3.4',transport:{type:'stdio'},packageArguments:[{type:'named',name:'--mode',value:'read'}],environmentVariables:[{name:'API_KEY',isRequired:true,default:'published-secret'},{name:'REGION',default:'us'}]};
    const option=parseRegistryEntry(envelope({remotes:[],packages:[p]}))!.options[0]!;
    expect(option.source).toMatchObject({kind:'npm',package:'@example/server',version:'2.3.4',args:['--mode','read']});expect(option.defaults).toEqual({REGION:'us'});expect(option.fields[0]!.secret).toBe(true);
    for(const patch of [{version:'latest'},{version:'^2.0.0'},{runtimeArguments:[{value:'--eval'}]},{packageArguments:[{type:'positional',value:'{folder}'}]},{registryBaseUrl:'https://packages.evil.test'},{packageArguments:'not an array'}])expect(parseRegistryEntry(envelope({remotes:[],packages:[{...p,...patch}]}))!.options).toEqual([]);
  });
  it('revalidates the pinned listing on install, rejects override and unknown fields, and separates browser login from keys',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>json(envelope())),registry=new PluginRegistry(fetcher);
    const ref={name:'org.example/docs',version:'1.0.0',optionId:'remote:0'};
    const resolved=await registry.resolve({registry:{...ref,authentication:'oauth'}});expect(resolved.source.auth).toBe('oauth');
    expect(String(fetcher.mock.calls[0]![0])).toContain('org.example%2Fdocs/versions/1.0.0');
    await expect(registry.resolve({registry:ref,source:{kind:'command',command:'evil'}})).rejects.toThrow('override');
    await expect(registry.resolve({registry:ref,credentials:{API_KEY:'private'}})).rejects.toThrow('Unexpected');
    fetcher.mockResolvedValueOnce(json(envelope({},'deleted')));await expect(registry.resolve({registry:ref})).rejects.toThrow('unavailable');
    fetcher.mockResolvedValueOnce(json(envelope({version:'2.0.0'})));await expect(registry.resolve({registry:ref})).rejects.toThrow('unavailable');
  });
  it('rejects missing required credentials before the installer can run and preserves optional defaults',async()=>{
    const server=envelope({remotes:[{type:'streamable-http',url:'https://example.com/mcp',headers:[{name:'Authorization',value:'Bearer {api_key}',isRequired:true}]}]});
    const registry=new PluginRegistry(vi.fn<typeof fetch>(async()=>json(server))),ref={name:'org.example/docs',version:'1.0.0',optionId:'remote:0'};
    await expect(registry.resolve({registry:ref})).rejects.toThrow('Missing required');
    await expect(registry.resolve({registry:{...ref,authentication:'oauth'}})).rejects.toThrow('declared credentials');
    expect((await registry.resolve({registry:ref,credentials:{Authorization:'key'}})).credentials).toEqual({Authorization:'key'});
  });
  it('bounds responses and rejects incompatible payloads without caching them',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('x'.repeat(2*1024*1024+1))).mockResolvedValueOnce(json({error:'not a directory'})).mockResolvedValueOnce(json({servers:[]}));
    const registry=new PluginRegistry(fetcher);await expect(registry.search()).rejects.toThrow('too large');await expect(registry.search()).rejects.toThrow('incompatible');await expect(registry.search()).resolves.toMatchObject({entries:[]});
  });
  it('does not silently drop non-secret template prefixes, accept conflicting runtimes, or import reserved object keys',()=>{
    const p={registryType:'npm',identifier:'@example/server',version:'2.3.4',transport:{type:'stdio'}};
    for(const patch of [{runtimeHint:'uvx'},{environmentVariables:[{name:'ENDPOINT',value:'https://{host}'}]},{environmentVariables:[{name:'__proto__',default:'bad'}]}])expect(parseRegistryEntry(envelope({remotes:[],packages:[{...p,...patch}]}))!.options).toEqual([]);
  });
});
