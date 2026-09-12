import { expect,it } from 'vitest';
import { mcpPurpose,marketplaceSearchTerm } from '../src/shared/mcp-presentation.js';
import { parseRegistryEntry,PluginRegistry } from '../src/main/plugins/registry.js';
import { normalizeRegistryIcon,publicIconAddress,allowedIconRedirect } from '../src/main/plugins/registry-icon.js';
import sharp from 'sharp';

it('explains the actual task and preserves price, read-only and source distinctions',()=>{
  const paid=mcpPurpose({name:'com.a2awire/example',description:'GitHub platform changelog feed. $0.01/query. Register in-session — free testnet funds.'});
  expect(paid.source).toBe('reviewed');expect(paid.text).toContain('0.01');expect(paid.text).toContain('更新公告');
  expect(mcpPurpose({name:'io.github.example/something',description:'Read-only Polymarket prediction market data for AI agents.'}).text).toContain('只读');
  const changed=mcpPurpose({name:'org.example/example',description:'Changed entirely'});expect(changed.source).toBe('unknown');
  expect(mcpPurpose({name:'io.github.example/weather',title:'Weather',description:'Forecasts'}).category).not.toBe('代码与仓库');
});
it('matches community introductions by exact repository, never by a similar name or monorepo root',()=>{
  expect(mcpPurpose({name:'a/b',repository:'https://github.com/calclavia/mcp-obsidian.git'})).toMatchObject({source:'community',text:expect.stringContaining('笔记')});
  expect(mcpPurpose({name:'calclavia/mcp-obsidian',repository:'https://github.com/another/mcp-obsidian'}).source).toBe('unknown');
  expect(mcpPurpose({name:'a/b',repository:'https://github.com/modelcontextprotocol/servers'}).source).not.toBe('community');
  expect(marketplaceSearchTerm('微软文档')).toBe('microsoft-learn-mcp');expect(marketplaceSearchTerm('anything else')).toBe('anything else');
});
it('accepts publisher images only from related origins or known image hosts and never changes install options',()=>{
  const make=(icons:unknown)=>parseRegistryEntry({server:{name:'org.example/tool',version:'1',websiteUrl:'https://example.org/',description:'Docs',icons,remotes:[{type:'streamable-http',url:'https://example.org/mcp'}]},_meta:{'io.modelcontextprotocol.registry/official':{status:'active'}}})!;
  const entry=make([{src:'https://example.org/logo.png',mimeType:'image/png'},{src:'https://example.org/logo.svg',mimeType:'image/svg+xml'},{src:'https://evil.org/a.png'},{src:'http://example.org/a.png'},{src:'https://127.0.0.1/a.png'},{src:'https://example.org:8443/a.png'},{src:'https://avatars.githubusercontent.com/u/1',mimeType:'image/jpeg'}]);
  expect(entry.icons).toHaveLength(2);expect(entry.options).toHaveLength(1);expect(make(undefined).icons).toEqual([]);
});
it('normalizes bounded raster images, rejects SVG and excessive pixels, and denies private DNS destinations',async()=>{
  const png=await sharp({create:{width:256,height:256,channels:4,background:'#48a'}}).png().toBuffer();
  const result=await normalizeRegistryIcon(png);expect(result).toMatch(/^data:image\/png;base64,/);
  const dimensions=await sharp(Buffer.from(result.split(',')[1]!,'base64')).metadata();expect(dimensions.width).toBe(96);
  await expect(normalizeRegistryIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))).rejects.toThrow();
  await expect(normalizeRegistryIcon(Buffer.alloc(512*1024+1))).rejects.toThrow('limit');
  const large=await sharp({create:{width:1025,height:1025,channels:3,background:'#fff'}}).png().toBuffer();await expect(normalizeRegistryIcon(large)).rejects.toThrow();
  for(const address of ['127.0.0.1','10.1.1.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1'])expect(publicIconAddress(address)).toBe(false);
  expect(publicIconAddress('8.8.8.8')).toBe(true);
  expect(publicIconAddress('198.18.0.1')).toBe(false);
  expect(allowedIconRedirect('https://example.com/icon','https://www.example.com/logo.png')).toBe(true);
  for(const target of ['http://example.com/logo','https://evil.com/a','https://example.com.evil.com/a','https://127.0.0.1/a','https://user:secret@example.com/a'])expect(allowedIconRedirect('https://example.com/icon',target)).toBe(false);
});
it('does not accept an arbitrary icon URL from IPC callers',async()=>{
  const registry=new PluginRegistry(async()=>{throw Error('No network expected');});
  await expect(registry.icon({name:'org.example/tool',version:'1',url:'https://example.com/logo.png'} as never)).rejects.toThrow();
});
