import { JSDOM } from 'jsdom';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import type {PluginRegistryPage} from '../src/shared/plugins.js';
let dom:JSDOM;
beforeEach(()=>{dom=new JSDOM('<section id="market"></section>',{url:'https://local.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node});});
afterEach(()=>dom.window.close());
it('does not mark favorites saved on failure and restores stored favorites without collapsing a card',async()=>{
  const {setLanguage}=await import('../src/renderer/i18n.js');setLanguage('en',false);
  let restore!:(value:unknown)=>void;
  const library=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{restore=resolve;})).mockResolvedValueOnce({ok:false,error:'Disk full'});
  window.api={pluginsRegistrySearch:vi.fn().mockResolvedValue({ok:true,data:page('one')}),pluginsLibrary:library} as never;
  const {mountPluginMarketplace}=await import('../src/renderer/plugin-marketplace.js');mountPluginMarketplace(document.getElementById('market')!,vi.fn());
  document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  const original=document.querySelector('details')!;original.open=true;
  restore({ok:true,data:{favorites:[],recent:[]}});await flush();expect(document.querySelector('details')).toBe(original);expect(original.open).toBe(true);
  const favorite=document.querySelector<HTMLButtonElement>('.marketplace-favorite')!;favorite.click();await flush();
  expect(favorite.getAttribute('aria-pressed')).toBe('false');expect(document.querySelector('.operation-feedback')!.textContent).toContain('Could not save');
});
const page=(name:string,cursor?:string):PluginRegistryPage=>({entries:[{name:`org.example/${name}`,title:name,version:'1',description:'<img src=x onerror=evil()>',options:[],unsupported:[]}],nextCursor:cursor,fetchedAt:1});
const flush=()=>new Promise(r=>setTimeout(r,0));
it('searches only on request, renders publisher content as text, and ignores an old result after the search changes',async()=>{
  const pending:Array<(r:unknown)=>void>=[];const search=vi.fn(()=>new Promise(resolve=>pending.push(resolve)));
  window.api={pluginsRegistrySearch:search} as never;
  const {mountPluginMarketplace}=await import('../src/renderer/plugin-marketplace.js');const choose=vi.fn();mountPluginMarketplace(document.getElementById('market')!,choose);
  expect(search).not.toHaveBeenCalled();const form=document.querySelector('form')!,input=document.querySelector('input')!;
  input.value='old';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));input.value='new';input.dispatchEvent(new dom.window.Event('input'));form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  pending[1]!({ok:true,data:page('new')});await flush();pending[0]!({ok:true,data:page('old')});await flush();
  expect(document.querySelector('.marketplace-entry strong')!.textContent).toBe('new');expect(document.querySelector('img')).toBeNull();(document.querySelector('.marketplace-entry') as HTMLButtonElement).click();expect(choose.mock.calls[0]![0].name).toBe('org.example/new');expect(input.value).toBe('new');
});
it('retains results on failed pagination and retries the same cursor',async()=>{
  const search=vi.fn().mockResolvedValueOnce({ok:true,data:page('one','next')}).mockResolvedValueOnce({ok:false,error:'Directory unavailable'}).mockResolvedValueOnce({ok:true,data:page('two')});window.api={pluginsRegistrySearch:search} as never;
  const {mountPluginMarketplace}=await import('../src/renderer/plugin-marketplace.js');mountPluginMarketplace(document.getElementById('market')!,vi.fn());
  document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  const more=[...document.querySelectorAll('button')].find(b=>b.textContent==='Load more MCPs')!;more.click();await flush();expect(document.querySelectorAll('.marketplace-entry')).toHaveLength(1);expect(document.querySelector('.operation-feedback')!.textContent).toBe('Directory unavailable');more.click();await flush();expect(document.querySelectorAll('.marketplace-entry')).toHaveLength(2);expect(search.mock.calls[2]![0].cursor).toBe('next');
});
it('shows a Chinese purpose, preserves expandable English and updates language without replacing search input',async()=>{
  const {setLanguage}=await import('../src/renderer/i18n.js');setLanguage('zh-CN',false);
  const data=page('microsoft-learn-mcp');data.entries[0]!.name='com.microsoft/microsoft-learn-mcp';data.entries[0]!.description='Search Microsoft documentation';
  const search=vi.fn().mockResolvedValue({ok:true,data});window.api={pluginsRegistrySearch:search} as never;
  const {mountPluginMarketplace}=await import('../src/renderer/plugin-marketplace.js');mountPluginMarketplace(document.getElementById('market')!,vi.fn());
  const input=document.querySelector('input')!;input.value='微软文档';document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  expect(search).toHaveBeenCalledWith({search:'microsoft-learn-mcp'});expect(document.querySelector('.marketplace-purpose')!.textContent).toContain('微软官方');
  const original=document.querySelector('details')!;expect(original.open).toBe(false);expect(original.textContent).toContain('Search Microsoft documentation');
  expect(document.querySelector('.mcp-logo')!.textContent).toBe('文');
  setLanguage('en',false);expect(document.querySelector('.marketplace-purpose')!.textContent).toBe('Search Microsoft documentation');expect(document.querySelector('input')).toBe(input);expect(input.value).toBe('微软文档');
});
it('keeps a readable icon on failure and cannot place a late logo in a replacement card',async()=>{
  const {mcpLogo}=await import('../src/renderer/mcp-presentation.js');
  let resolve!:(v:unknown)=>void;window.api={pluginsRegistryIcon:vi.fn(()=>new Promise(r=>{resolve=r;}))} as never;
  const old=mcpLogo({name:'org.example/a',version:'1',description:'Search'});document.body.append(old);await flush();old.remove();
  const replacement=mcpLogo({name:'org.example/b',description:'Database'});document.body.append(replacement);
  resolve({ok:true,data:{dataUrl:'data:image/png;base64,YQ=='}});await flush();expect(replacement.dataset.kind).toBe('category');expect(replacement.querySelector('img')).toBeNull();
});
it('refreshes installed membership without collapsing originals or replacing focused cards',async()=>{
  window.api={pluginsRegistrySearch:vi.fn().mockResolvedValue({ok:true,data:page('one')})} as never;
  const {mountPluginMarketplace}=await import('../src/renderer/plugin-marketplace.js');const market=mountPluginMarketplace(document.getElementById('market')!,vi.fn());
  document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  const original=document.querySelector('details')!;original.open=true;const card=document.querySelector('.marketplace-entry') as HTMLButtonElement;card.focus();
  market.setInstalled([{registry:{name:'org.example/one',version:'1',optionId:'remote:0'}}] as never);
  expect(document.querySelector('details')).toBe(original);expect(original.open).toBe(true);expect(document.activeElement).toBe(card);expect(card.textContent).toContain('Installed');
});
