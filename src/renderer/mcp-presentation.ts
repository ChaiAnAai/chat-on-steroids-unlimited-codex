import { el } from './dom.js';
import { currentLanguage, t, ui } from './i18n.js';
import { mcpPurpose, chineseCatalogSource, type McpPresentationInput } from '../shared/mcp-presentation.js';

export function purposeText(input:McpPresentationInput):string { return currentLanguage()==='zh-CN'?mcpPurpose(input).text:input.description??''; }
export function purposeNote(input:McpPresentationInput):string {
  const source=mcpPurpose(input).source;
  return t(source==='community'?'Chinese community description':source==='reviewed'?'Chinese reference':source==='publisher'?'Publisher description':source==='category'?'Category inferred from listing':'Chinese description not yet available');
}
export function originalDescription(input:McpPresentationInput):HTMLElement {
  const details=document.createElement('details');details.className='marketplace-original';
  details.append(el('summary','',()=>t('Original description & source')),el('p','',input.description||t('Description not supplied')),el('p','marketplace-identity',input.name));
  const note=el('p','hint',()=>purposeNote(input));details.append(note);
  if(input.description) {
    const translate=el('button','btn',()=>t('Translate original in browser')) as HTMLButtonElement;translate.type='button';
    translate.addEventListener('click',async()=>{
      translate.disabled=true;
      try {const result=await window.api.openLink(`https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(input.description!)}&op=translate`);if(!result.ok)ui(note,'textContent',()=>t('Could not open translation. Try again.'));}
      catch {ui(note,'textContent',()=>t('Could not open translation. Try again.'));}
      finally {translate.disabled=false;}
    });details.append(translate);
  }
  if(mcpPurpose(input).source==='community') {
    const source=el('button','btn',()=>t('Chinese community source')) as HTMLButtonElement;source.type='button';
    source.addEventListener('click',async()=>{
      source.disabled=true;
      try {const result=await window.api.openLink(chineseCatalogSource);if(!result.ok)throw new Error();}
      catch {ui(note,'textContent',()=>t('Could not open the source. Try again.'));}
      finally {source.disabled=false;}
    });details.append(source);
  }
  return details;
}

let active=0;
const queue:Array<()=>Promise<void>>=[];
const observed=new Set<Element>();
let observer:IntersectionObserver|undefined;
const loads=new WeakMap<Element,()=>void>();
function pump(){while(active<2&&queue.length){active++;void queue.shift()!().finally(()=>{active--;pump();});}}
/** A decorative category tile is always present. Only main-process normalized PNGs replace it. */
export function mcpLogo(input:McpPresentationInput & {version?:string;icons?:unknown[]}):HTMLElement {
  const purpose=mcpPurpose(input),tile=el('span','mcp-logo',purpose.glyph);
  tile.dataset.kind='category';ui(tile,'title',()=>t('Category icon · {0}',[purpose.category]));tile.setAttribute('aria-hidden','true');
  if(!input.version || input.icons?.length===0 || !window.api.pluginsRegistryIcon)return tile;
  let requested=false;
  const load=()=>{if(requested)return;requested=true;queue.push(async()=>{
    if(!tile.isConnected)return;
    try {
      const result=await window.api.pluginsRegistryIcon({name:input.name,version:input.version!});
      if(!tile.isConnected || !result.ok || !result.data || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(result.data.dataUrl))return;
      const img=document.createElement('img');img.alt='';img.width=40;img.height=40;
      img.onload=()=>{if(tile.isConnected){tile.replaceChildren(img);tile.dataset.kind='publisher';tile.dataset.theme=result.data!.theme??'light';ui(tile,'title',()=>t('Publisher-provided logo'));}};
      img.src=result.data.dataUrl;
    }catch{/* Keep the category icon; logo failure cannot block installation. */}
  });pump();};
  if(typeof IntersectionObserver!=='undefined') {
    observer??=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer!.unobserve(entry.target);observed.delete(entry.target);loads.get(entry.target)?.();}},{rootMargin:'80px'});
    for(const previous of observed)if(!previous.isConnected){observer.unobserve(previous);observed.delete(previous);}
    loads.set(tile,load);observed.add(tile);observer.observe(tile);
  }else queueMicrotask(load);
  return tile;
}
