import { el, feedback } from './dom.js';
import { ui, t } from './i18n.js';
import type { PluginRegistryEntry, PluginRegistryPage, PluginView } from '../shared/plugins.js';
import { marketplaceSearchTerm, mcpPurpose } from '../shared/mcp-presentation.js';
import { currentLanguage } from './i18n.js';
import { mcpLogo, originalDescription, purposeText, purposeNote } from './mcp-presentation.js';
const categoryEnglish: Record<string, string> = {
  '笔记与知识库': 'Notes & knowledge', '招聘与人才': 'Recruitment', '演示与排版': 'Presentations',
  '代码与仓库': 'Code & repositories', '文档检索': 'Documentation', '表格与数据': 'Spreadsheets & data',
  '记忆与协作': 'Memory & collaboration', '浏览器自动化': 'Browser automation', '搜索与采集': 'Search & collection',
  '图像与创作': 'Images & creation', '数据库': 'Databases', '金融与链上数据': 'Finance & blockchain',
  '内容与社交': 'Content & social', '服务与工具': 'Services & tools', '其他工具': 'Other tools'
};

export function mountPluginMarketplace(host: HTMLElement, choose: (entry: PluginRegistryEntry) => void) {
  let generation=0, page:PluginRegistryPage|undefined, shownQuery='', installed:PluginView[]=[];
  let library: { favorites: string[]; recent: { name: string; at: number }[] } = { favorites: [], recent: [] };
  let libraryQueue: Promise<unknown> = Promise.resolve();
  function updateLibrary(request: () => Parameters<typeof window.api.pluginsLibrary>[0]) {
    const operation = libraryQueue.then(async () => {
      const result = await window.api.pluginsLibrary(request());
      if (!result.ok) throw new Error(result.error);
      library = result.data;
      for (const update of updateMembership) update();
      if (collection.value !== 'all') render();
    });
    libraryQueue = operation.catch(() => undefined);
    return operation;
  }
  const filters = el('div', 'marketplace-filters');
  const category = document.createElement('select'), collection = document.createElement('select');
  ui(category, 'aria-label', () => t('Category in loaded results'));
  ui(collection, 'aria-label', () => t('Collection in loaded results'));
  for (const [value, title] of [['all', 'All loaded results'], ['favorites', 'Favorites in loaded results'], ['recent', 'Recently viewed in loaded results']]) {
    const option = document.createElement('option'); option.value = value!; ui(option, 'textContent', () => t(title!)); collection.append(option);
  }
  filters.append(category, collection);
  const updateMembership:Array<()=>void>=[];
  const header=el('div','plugin-section-head'), title=el('h2','',()=>t('Online MCP marketplace'));
  header.append(title,el('span','muted',()=>t('Official MCP Registry')));
  const description=el('p','muted',()=>t('Search the public directory, choose an MCP, and fill only the settings it needs. Sign in through your browser when required.'));
  const form=document.createElement('form'); form.className='marketplace-search';
  const search=document.createElement('input'); search.type='search'; search.maxLength=160;
  ui(search,'placeholder',()=>t('Search online MCPs, e.g. GitHub, Notion, search'));
  ui(search,'aria-label',()=>t('Search online MCPs'));
  const submit=el('button','btn btn-solid',()=>t('Search directory')) as HTMLButtonElement; submit.type='submit';
  form.append(search,submit);
  const status=el('div','operation-feedback'); status.hidden=true;
  const heading=el('p','marketplace-result-heading muted');
  const rows=el('div','marketplace-results');
  const more=el('button','btn',()=>t('Load more MCPs')) as HTMLButtonElement; more.type='button'; more.hidden=true;
  const links=el('div','marketplace-links');
  for(const [name,url] of [['Official MCP Registry','https://registry.modelcontextprotocol.io/'],['Smithery','https://smithery.ai/servers'],['Glama','https://glama.ai/mcp/servers']]) {
    const link=el('button','btn',()=>t('Browse {0}',[name!])) as HTMLButtonElement; link.type='button';
    link.addEventListener('click',async()=>{
      try { const result=await window.api.openLink(url!); if(!result.ok) feedback(status,result.error,'error'); }
      catch {feedback(status,t('Could not open the marketplace. Try again.'),'error');}
    }); links.append(link);
  }
  host.append(header,description,form,filters,status,heading,rows,more,links,
    el('p','hint',()=>t('Directory listings are supplied by publishers, not a security endorsement. Other marketplaces open in your browser; use Add a plugin to import their MCP URL or package.')));
  function render() {
    rows.replaceChildren();
    updateMembership.length=0;
    if(!page) return;
    const selectedCategory = category.value;
    category.replaceChildren();
    const allCategory = document.createElement('option'); allCategory.value = ''; ui(allCategory, 'textContent', () => t('All categories in loaded results')); category.append(allCategory);
    for (const title of [...new Set(page.entries.map(entry => mcpPurpose(entry).category))]) { const option = document.createElement('option'); option.value = title; ui(option, 'textContent', () => currentLanguage() === 'zh-CN' ? title : categoryEnglish[title] ?? 'Other tools'); category.append(option); }
    if ([...category.options].some(option => option.value === selectedCategory)) category.value = selectedCategory;
    const visible = page.entries.filter(entry => (!category.value || mcpPurpose(entry).category === category.value) &&
      (collection.value === 'all' || (collection.value === 'favorites' ? library.favorites.includes(entry.name) : library.recent.some(row => row.name === entry.name))));
    if (collection.value === 'recent') visible.sort((a, b) => library.recent.findIndex(row => row.name === a.name) - library.recent.findIndex(row => row.name === b.name));
    ui(heading,'textContent',()=>t('Showing {0} of {1} loaded results',[visible.length,page!.entries.length]));
    for(const entry of visible) {
      const button=document.createElement('button'); button.type='button';button.className='marketplace-entry';
      const copy=el('span','marketplace-entry-copy'),identity=el('span','marketplace-identity',entry.name);identity.title=entry.name;
      copy.append(el('span','marketplace-purpose',()=>purposeText(entry)),el('strong','',entry.title),el('span','marketplace-purpose-note',()=>currentLanguage()==='zh-CN'?`${mcpPurpose(entry).category} · ${purposeNote(entry)}`:''));
      const conditions = new Set(entry.options.map(option => option.source.kind === 'remote' ? t('Remote service') : t('Local runtime required')));
      if (entry.options.some(option => option.fields.some(field => field.required && field.secret))) conditions.add(t('Credential required'));
      if (!entry.options.length) conditions.add(t('Manual setup'));
      copy.append(el('span', 'marketplace-purpose-note', [...conditions].join(' · ')));
      const action=el('span','marketplace-entry-action');
      const update=()=>ui(action,'textContent',()=>installed.some(plugin=>plugin.registry?.name===entry.name)?t('Installed'):entry.options.length?t('Set up'):t('View setup guide'));
      update();updateMembership.push(update);
      button.append(mcpLogo(entry),copy,action);button.addEventListener('click',()=>{
        choose(entry);
        if (typeof window.api.pluginsLibrary === 'function') void updateLibrary(() => ({action:'view',name:entry.name})).catch(()=>feedback(status,t('Could not save recently viewed MCPs. Try again.'),'error'));
      });
      const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'btn marketplace-favorite';
      const paintFavorite = () => { const saved = library.favorites.includes(entry.name); favorite.setAttribute('aria-pressed', String(saved)); ui(favorite, 'textContent', () => t(saved ? 'Saved to favorites' : 'Add to favorites')); };
      paintFavorite(); updateMembership.push(paintFavorite); favorite.addEventListener('click', async () => {
        favorite.disabled = true;
        try {
          await updateLibrary(() => ({ action:'favorite', name:entry.name, enabled:!library.favorites.includes(entry.name) }));
          if (!favorite.isConnected) collection.focus();
          feedback(status,t('Favorites saved.'),'success');
        } catch { feedback(status,t('Could not save favorites. Try again.'),'error'); }
        finally { favorite.disabled = false; }
      });
      const card=el('article','marketplace-card'), footer=el('div','marketplace-card-footer');footer.append(originalDescription(entry),favorite);card.append(button,footer);rows.append(card);
    }
    if(!visible.length) rows.append(el('p','muted',()=>t('No matching loaded results. Change filters or load more MCPs.')));
    more.hidden=!page.nextCursor;
  }
  async function load(append=false) {
    const own=++generation, query=append?shownQuery:search.value.trim(), cursor=append?page?.nextCursor:undefined;
    submit.disabled=true;more.disabled=true;form.setAttribute('aria-busy','true');feedback(status,t('Loading MCP directory…'),'busy');
    try {
      const result=await window.api.pluginsRegistrySearch({search:marketplaceSearchTerm(query),...(cursor?{cursor}:{})});
      if(own!==generation) return;
      if(!result.ok) {feedback(status,t(result.error),'error');return;}
      const next=result.data;
      const entries=append?[...(page?.entries??[]),...next.entries]:next.entries;
      page={...next,entries:[...new Map(entries.map(e=>[`${e.name}@${e.version}`,e])).values()]};shownQuery=query;
      render();status.hidden=true;
    } catch {if(own===generation)feedback(status,t('Could not load the MCP directory. Check your network and search again. Your previous results are retained.'),'error');}
    finally {if(own===generation){submit.disabled=false;more.disabled=false;form.removeAttribute('aria-busy');}}
  }
  form.addEventListener('submit',event=>{event.preventDefault();void load();});
  category.addEventListener('change',render);collection.addEventListener('change',render);
  if (typeof window.api.pluginsLibrary === 'function') void updateLibrary(() => ({action:'list'})).catch(()=>feedback(status,t('Could not load saved MCP collections. Try again.'),'error'));
  more.addEventListener('click',()=>void load(true));
  search.addEventListener('input',()=>{generation++;submit.disabled=false;more.disabled=false;form.removeAttribute('aria-busy');if(!status.hidden){ui(status,'textContent',()=>t('Search to update the results.'));delete status.dataset.tone;}});
  return {setInstalled(plugins:PluginView[]){installed=plugins;for(const update of updateMembership)update();}};
}
