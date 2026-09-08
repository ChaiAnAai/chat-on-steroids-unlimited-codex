// Exercise the actual Electron renderer/IPC in a disposable profile, without sending a task.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.resolve(process.argv[2] || 'node_modules/electron/dist/electron.exe');
const profile = await mkdtemp(path.join(tmpdir(), 'cos-workspace-ui-'));
const output = path.join(root, 'release', 'ui-evidence'); await mkdir(output, { recursive: true });
const env = { ...process.env, CLF_BRIDGE_PORTS: '0' }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [...(path.basename(executable) === 'electron.exe' ? [root] : []), `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'], { env, stdio: 'ignore', windowsHide: true });
let socket; let serial = 0; const pending = new Map();
async function until(fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { const result = await fn().catch(() => null); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('UI startup timed out');
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function capture(name) {
  // Capture settled surfaces, excluding perpetual activity indicators.
  await evaluate("new Promise(resolve => setTimeout(resolve, 350))");
  const result = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(output, name), Buffer.from(result.data, 'base64'));
}
try {
  const port = await until(async () => Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]));
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page'));
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', raw => { const message = JSON.parse(String(raw)); const flight = pending.get(message.id); if (!flight) return; pending.delete(message.id); clearTimeout(flight.timeout); message.error ? flight.reject(new Error(JSON.stringify(message.error))) : flight.resolve(message.result); });
  // Wait for Electron/preload startup before evaluating in its renderer context.
  await until(async () => (await readFile(path.join(profile, 'app.log'), 'utf8')).includes('renderer state ready'));
  await until(() => evaluate("!!document.getElementById('taskInspector') && !!document.getElementById('languageLabel')?.textContent"));
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  console.log('initial', await evaluate("({lang:document.documentElement.lang,label:document.getElementById('languageLabel').textContent})"));
  await evaluate("if(document.documentElement.lang !== 'zh-CN') { document.querySelector('#appearanceMenu > summary').click(); document.getElementById('languageBtn').click(); document.querySelector('[data-language=zh-CN]').click(); }");
  await until(async () => { const language = await evaluate("document.documentElement.lang"); return language === 'zh-CN'; });
  await evaluate("document.getElementById('workspaceSettings').click(); document.querySelector('[data-tab=setup]').click()");
  if (!(await evaluate("document.querySelectorAll('#wizard .setup-step-content:not([hidden])').length === 1 && !document.getElementById('tunnelKind').closest('.advanced')"))) throw new Error('Setup did not focus the first required step');
  await capture('workspace-setup-guided.png');
  await evaluate("(()=>{const s=document.getElementById('tunnelKind');s.value='cloudflared';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await until(async () => JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).tunnel.kind === 'cloudflared');
  if (!(await evaluate("document.querySelector('[data-step=tunnel]').hidden && document.querySelector('[data-step=key]').hidden && document.getElementById('setupProgress').textContent.endsWith('/ 4')"))) throw new Error('Quick setup still requires tunnel credentials');
  await capture('workspace-setup-quick.png');
  await evaluate("(()=>{const s=document.getElementById('tunnelKind');s.value='openai';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await until(async () => JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).tunnel.kind === 'openai');
  await evaluate("document.getElementById('wizExpand').click()");
  if (!(await evaluate("document.getElementById('backgroundRunningCopy').textContent.includes('系统托盘') && document.getElementById('chatgptConn').textContent.includes('连接方式选择') && document.querySelector('#connectorCards .tag').textContent === '必需' && document.querySelector('#connectorCards button').textContent.includes('复制')"))) throw new Error('Setup dynamic interface has untranslated copy');
  await evaluate("document.getElementById('chatgptConn').scrollIntoView({block:'start'})");
  await capture('workspace-setup-chinese.png');
  await evaluate("document.getElementById('backToChat').click()");
  if (!(await evaluate("document.querySelector('.app').dataset.screen === 'chat' && document.querySelector('[data-workflow=implement]').getClientRects().length > 0"))) throw new Error('Task workspace is not visible');
  await capture('workspace-dark.png');
  await evaluate("document.querySelector('#appearanceMenu > summary').click(); document.getElementById('languageBtn').click()");
  await capture('workspace-language-picker.png');
  await evaluate("document.getElementById('languageDialog').close()");
  await evaluate("document.getElementById('chatInput').value = 'Draft / KEEP_ME'; document.getElementById('chatInput').dispatchEvent(new Event('input',{bubbles:true}))");
  for (const [language, label] of [['ja', '新しいタスク'], ['ko', '새 작업'], ['es', 'Nueva tarea'], ['fr', 'Nouvelle tâche'], ['de', 'Neue Aufgabe'], ['zh-TW', '新任務'], ['en', 'New task'], ['zh-CN', '新任务']]) {
    await evaluate(`document.querySelector('#appearanceMenu > summary').click(); document.getElementById('languageBtn').click(); document.querySelector('[data-language="${language}"]').click()`);
    await until(() => evaluate(`document.documentElement.lang === '${language}' && document.getElementById('newChat').textContent.trim() === '${label}'`));
    await until(async () => JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).ui.language === language);
    if (await evaluate("document.getElementById('chatInput').value") !== 'Draft / KEEP_ME') throw new Error('Language switch changed the authored draft');
    if (['fr', 'de', 'es', 'en'].includes(language) && /[\u3400-\u9fff]/.test(await evaluate("document.getElementById('sessionsFoot').textContent"))) throw new Error('Empty task footer retained a previous language');
    if (['ja', 'fr'].includes(language)) await capture(`workspace-${language}.png`);
  }
  await evaluate("document.getElementById('chatInput').value = ''; document.getElementById('chatInput').dispatchEvent(new Event('input',{bubbles:true}))");
  await evaluate("document.querySelector('.sidebar-resize').focus()");
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  if (!(await evaluate("JSON.parse(localStorage.getItem('workspace-shell-v1')).width === 254"))) throw new Error('Keyboard sidebar resizing did not persist');
  await until(() => evaluate("Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - 254) < 1"));
  const divider = await evaluate("(()=>{const r=document.querySelector('.sidebar-resize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+200}})()");
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...divider, button: 'left', buttons: 1, clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: divider.x + 26, y: divider.y, button: 'left', buttons: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: divider.x + 26, y: divider.y, button: 'left', buttons: 0, clickCount: 1 });
  // Pointer capture is released asynchronously; persistence follows lostpointercapture.
  await until(() => evaluate("JSON.parse(localStorage.getItem('workspace-shell-v1')).width === 280"));
  await evaluate("document.querySelector('#appearanceMenu > summary').click(); document.getElementById('languageBtn').focus()");
  await capture('workspace-appearance.png');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  if (!(await evaluate("!document.getElementById('appearanceMenu').open && document.activeElement === document.querySelector('#appearanceMenu > summary')"))) throw new Error('Menu Escape failed to restore focus: '+JSON.stringify(await evaluate("({open:document.getElementById('appearanceMenu').open,focus:document.activeElement?.id,tag:document.activeElement?.tagName})")));
  await evaluate("document.querySelector('[data-workflow=implement]').click()");
  const draft = await evaluate("document.getElementById('chatInput').value");
  if (!draft.includes('当前项目')) throw new Error('Workflow did not populate a Chinese draft');
  await evaluate("document.querySelector('#workflowMenu > summary').focus()");
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await until(() => evaluate("document.activeElement?.closest('#workflowMenu .composer-popover') !== null"));
  await capture('workspace-workflow-menu.png');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  if (!(await evaluate("!document.getElementById('workflowMenu').open && document.activeElement === document.querySelector('#workflowMenu > summary')"))) throw new Error('Workflow menu keyboard dismissal failed');
  await evaluate("document.getElementById('connectionHelp').click()");
  if (!(await evaluate("document.getElementById('detailsToggle').getAttribute('aria-expanded') === 'true' && document.getElementById('taskInspector').textContent.includes('浏览器')"))) throw new Error('Connection inspector failed');
  await capture('workspace-details.png');
  await evaluate("document.getElementById('detailsToggle').click(); document.querySelector('#appearanceMenu > summary').click(); document.getElementById('themeBtn').click()");
  await until(() => evaluate("document.documentElement.dataset.theme === 'light'"));
  await call('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await capture('workspace-light-compact.png');
  const bounds = await evaluate("(()=>{const f=document.getElementById('composer').getBoundingClientRect();const s=document.getElementById('chatSend').getBoundingClientRect();return {width:innerWidth,formRight:f.right,sendRight:s.right,sendBottom:s.bottom,height:innerHeight,draft:document.getElementById('chatInput').value};})()");
  if (bounds.sendRight > bounds.width || bounds.sendBottom > bounds.height || bounds.draft !== draft) throw new Error('Composer clipped or draft lost');
  await evaluate("document.querySelector('#appearanceMenu > summary').click(); document.getElementById('customizeAppearance').click()");
  if (!(await evaluate("document.getElementById('appearanceDialog').open && document.getElementById('appearanceTitle').textContent === '自定义外观'"))) throw new Error('Appearance dialog did not open in Chinese');
  await evaluate("(()=>{for(const [key,value] of Object.entries({textSize:'18',codeSize:'16',density:'compact',accent:'#31a475',font:'mono',chatWidth:'900',corners:'round'})){const e=document.querySelector('[data-preference='+key+']');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}})()");
  await until(async () => JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).ui.appearance?.corners === 'round');
  const appearanceSaved = JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).ui.appearance;
  if (appearanceSaved.textSize !== 18 || appearanceSaved.accent !== '#31a475' || appearanceSaved.font !== 'mono') throw new Error('Appearance preferences lost across real IPC saves');
  if (!(await evaluate("getComputedStyle(document.getElementById('chatInput')).fontSize === '18px' && Math.abs(document.getElementById('appearanceDialog').getBoundingClientRect().left - (innerWidth - document.getElementById('appearanceDialog').getBoundingClientRect().width)/2) < 2"))) throw new Error('Appearance font override or dialog centering failed');
  await capture('workspace-customize-appearance.png');
  await evaluate("document.querySelector('#appearanceDialog header button').click()");
  await call('Page.reload');
  await until(() => evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ui-text-size').trim() === '18px'"));
  if (!(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim() === '#31a475'"))) throw new Error('Appearance did not restore after reload');
  await evaluate("document.getElementById('backToChat').click(); document.querySelector('#appearanceMenu > summary').click(); document.getElementById('customizeAppearance').click(); document.querySelector('#appearanceDialog > button').click()");
  await until(async () => JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8')).ui.appearance?.textSize === 14);
  if (!(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ui-text-size').trim() === '14px'"))) throw new Error('Appearance reset did not restore default styles');
  await evaluate("document.querySelector('#appearanceDialog header button').click()");
  await evaluate("new Promise(resolve => setTimeout(resolve, 250))");
  // Exercise rapid reversal and both motion preferences in the shipping Chromium runtime.
  if (!(await evaluate("CSS.supports('transition-behavior','allow-discrete')"))) throw new Error('Discrete dialog transitions unsupported');
  await evaluate("(()=>{const d=document.getElementById('appearanceDialog');d.showModal();d.close();d.showModal()})()");
  await until(() => evaluate("document.getElementById('appearanceDialog').open && getComputedStyle(document.getElementById('appearanceDialog')).opacity === '1'"));
  await evaluate("document.getElementById('appearanceDialog').close(); document.documentElement.dataset.reduceMotion='true'");
  if (!(await evaluate("parseFloat(getComputedStyle(document.querySelector('.app')).transitionDuration) < .001"))) throw new Error('App reduced motion failed');
  await evaluate("document.documentElement.dataset.reduceMotion='false'");
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  if (!(await evaluate("getComputedStyle(document.querySelector('.app')).transitionDuration === '0s' && getComputedStyle(document.getElementById('appearanceDialog')).transitionDuration === '0s'"))) throw new Error('System reduced motion failed');
  await call('Emulation.setEmulatedMedia', { features: [] });
  const log = await readFile(path.join(profile, 'app.log'), 'utf8');
  if (/renderer: |window failed to load/.test(log)) throw new Error('Renderer logged an error');
  const saved = JSON.parse(await readFile(path.join(profile, 'config.json'), 'utf8'));
  if (saved.ui.language !== 'zh-CN') throw new Error('Language did not persist through the real IPC boundary');
  if (!(await evaluate("CSS.supports('selector(details::details-content)') && CSS.supports('interpolate-size','allow-keywords')"))) throw new Error('Native surface transitions unavailable');
  await evaluate("document.getElementById('backToChat').click();document.documentElement.dataset.theme='dark';document.getElementById('appearanceMenu').open=false");
  await evaluate("new Promise(resolve => setTimeout(resolve,350))");
  await evaluate("document.getElementById('appearanceMenu').open=true");
  const opening = await evaluate("new Promise(resolve=>setTimeout(()=>resolve(getComputedStyle(document.getElementById('appearanceMenu'),'::details-content').opacity),60))");
  if (!(Number(opening) > 0 && Number(opening) < 1)) throw new Error(`Menu opening has no intermediate frame: ${opening}`);
  await evaluate("new Promise(resolve=>setTimeout(resolve,300))");
  await evaluate("document.getElementById('appearanceMenu').open=false");
  const closing = await evaluate("new Promise(resolve=>setTimeout(()=>resolve(getComputedStyle(document.getElementById('appearanceMenu'),'::details-content').opacity),60))");
  if (!(Number(closing) > 0 && Number(closing) < 1)) throw new Error(`Menu closing has no intermediate frame: ${closing}`);
  if (process.env.COS_RECORD_MOTION === '1') {
    const frames = await mkdtemp(path.join(output, 'motion-')); const samples = [];
    await evaluate("(()=>{const d=document.getElementById('appearanceDialog');setTimeout(()=>d.showModal(),300);setTimeout(()=>d.close(),1500);setTimeout(()=>d.showModal(),2200);setTimeout(()=>d.close(),3400)})()");
    const start = Date.now();
    while (Date.now() - start < 4200) {
      const at = Date.now(); const shot = await call('Page.captureScreenshot', {format:'png'});
      const file = `frame-${String(samples.length).padStart(4,'0')}.png`;
      await writeFile(path.join(frames,file),Buffer.from(shot.data,'base64')); samples.push({at,file});
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    const concat = samples.map((sample,index)=>`file '${sample.file}'\nduration ${((samples[index+1]?.at ?? sample.at+150)-sample.at)/1000}`).join('\n');
    await writeFile(path.join(frames,'frames.txt'),concat+'\n');
    const encoded = spawnSync('ffmpeg', ['-y','-loglevel','error','-f','concat','-safe','0','-i',path.join(frames,'frames.txt'),'-vf','fps=20,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse','-loop','0',path.join(output,'workspace-motion.gif')], {windowsHide:true,encoding:'utf8'});
    if (encoded.status !== 0) throw new Error(`Motion recording encode failed: ${encoded.stderr}`);
  }
  // Measure actual content bounds, including controls that must remain visible while scrolling.
  const layoutChecks = [];
  for (const [width, height] of [[1600,1000],[1280,800],[1000,700],[800,600],[640,480]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate("document.getElementById('appearanceMenu').open=false;document.getElementById('appearanceDialog').showModal()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,350))");
    const appearanceBounds = await evaluate("(()=>{const d=document.getElementById('appearanceDialog'),r=d.getBoundingClientRect(),f=d.querySelector(':scope > button').getBoundingClientRect(),h=d.querySelector('header').getBoundingClientRect(),c=d.querySelector('.appearance-content');return {width:r.width,height:r.height,fits:r.left>=8&&r.right<=innerWidth-8&&r.top>=8&&r.bottom<=innerHeight-8,actionsVisible:f.bottom<=r.bottom-8&&h.top>=r.top,innerScroll:c.scrollHeight>c.clientHeight}})()");
    if (!appearanceBounds.fits || !appearanceBounds.actionsVisible) throw new Error(`Appearance clipped at ${width}x${height}: ${JSON.stringify(appearanceBounds)}`);
    if (width===1000 || width===640) await capture(`workspace-appearance-${width}.png`);
    await evaluate("document.getElementById('appearanceDialog').close();document.getElementById('languageDialog').showModal()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,350))");
    if (!(await evaluate("(()=>{const b=document.querySelector('.language-close').getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight-8})()"))) throw new Error(`Language Done clipped at ${width}`);
    await evaluate("document.getElementById('languageDialog').close();document.querySelector('.task-rename').showModal()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,350))");
    if (!(await evaluate("(()=>{const r=document.querySelector('.task-rename').getBoundingClientRect();return r.left>=16&&r.right<=innerWidth-16&&r.top>=16&&r.bottom<=innerHeight-16&&Math.abs(r.left+r.width/2-innerWidth/2)<2})()"))) throw new Error(`Rename dialog bounds failed at ${width}`);
    await evaluate("document.querySelector('.task-rename').close();document.getElementById('connectionHelp').click()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,350))");
    const inspector = await evaluate("(()=>{const p=document.getElementById('taskInspector'),r=p.getBoundingClientRect(),c=document.querySelector('[data-panel=chat] > .is-session').getBoundingClientRect();return {mode:getComputedStyle(p).position,chatWidth:c.width,fits:r.right<=innerWidth&&r.left>=0}})()");
    if (!inspector.fits || (inspector.mode==='static' && inspector.chatWidth<560)) throw new Error(`Inspector squeezes chat at ${width}: ${JSON.stringify(inspector)}`);
    await evaluate("document.querySelector('.inspector-heading button').click();document.getElementById('workflowMenu').open=true");
    await evaluate("new Promise(resolve=>setTimeout(resolve,350))");
    if (!(await evaluate("(()=>{const r=document.querySelector('#workflowMenu .composer-popover').getBoundingClientRect(),s=document.getElementById('chatSend').getBoundingClientRect();return r.left>=8&&r.right<=innerWidth-8&&r.top>=8&&s.bottom<=innerHeight&&s.right<=innerWidth})()"))) throw new Error(`Composer menu clipped at ${width}x${height}`);
    await evaluate("document.getElementById('workflowMenu').open=false");
    layoutChecks.push({width,height,appearanceBounds,inspector});
  }
  await writeFile(path.join(output,'responsive-layout-checks.json'),JSON.stringify(layoutChecks,null,2));
  await call('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
  // UI-only catalogue fixture in this disposable renderer; it proves slider interaction,
  // not account access. No request is sent and no production discovery path is changed.
  const fixture = await build({ stdin: { contents: "export { initChatModels, applyChatModels, confirmedComposerModel } from './src/renderer/chat-models.ts'; export { setUiLanguage } from './src/renderer/i18n.ts';", resolveDir: root }, bundle: true, format: 'iife', globalName: 'PreviewModels', write: false });
  await evaluate("(()=>{const frame=document.createElement('iframe');frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999';document.body.append(frame);const d=frame.contentDocument;d.head.innerHTML=document.head.innerHTML;d.body.innerHTML=document.body.innerHTML;d.querySelector('iframe')?.remove();d.querySelectorAll('dialog').forEach(x=>x.remove());d.querySelector('.app').dataset.screen='chat';d.querySelectorAll('[data-panel]').forEach(x=>x.classList.toggle('is-active',x.dataset.panel==='chat'));d.documentElement.dataset.theme='dark';globalThis.previewDoc=d})()");
  await evaluate(`(async function(window, document) { ${fixture.outputFiles[0].text}
    PreviewModels.setUiLanguage('zh-CN');
    PreviewModels.initChatModels(); PreviewModels.applyChatModels({multiAgent:{},goal:{}});
    await Promise.resolve();
    globalThis.checkPreviewModel = PreviewModels.confirmedComposerModel;
  })({api:{getChatModels:async()=>({ok:true,data:{state:'ready',requestedAt:1,observedAt:Date.now(),models:[{id:'fixture-sol',label:'GPT-5.6 Sol',efforts:['low','medium','high','xhigh']},{id:'fixture-astra',label:'GPT-6 Astra',efforts:['high','pro']}]}})}}, previewDoc)`);
  await evaluate("previewDoc.getElementById('modelMenu').open=true;previewDoc.querySelector('#composerPowerChoices input').focus()");
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
  if (!(await evaluate("checkPreviewModel()?.model === 'fixture-astra' && checkPreviewModel()?.reasoningEffort === 'pro'"))) throw new Error('Model slider keyboard selection failed');
  await evaluate("previewDoc.querySelector('.power-model[data-model=fixture-sol]').click()");
  if (!(await evaluate("checkPreviewModel()?.model === 'fixture-sol' && checkPreviewModel()?.reasoningEffort === 'high'"))) throw new Error('Model shortcut did not choose an observed step');
  await capture('workspace-model-slider-fixture.png');
  console.log(JSON.stringify({ renderer: 'actual Electron', profile, output, languagePersisted: 'zh-CN', supportedLanguagesChecked: 8, languageSwitchPreservesDraft: true, workflowKeyboardNavigation: true, appearancePersistsAndResets: true, workflowDraft: true, connectionInspector: true, compactComposerVisible: true, rapidDialogReopen: true, appAndSystemReducedMotion: true, guidedSetup: true, quickSetupPersists: true, modelSliderKeyboardFixture: true }));
} finally {
  socket?.close();
  for (const flight of pending.values()) clearTimeout(flight.timeout);
  if (child.pid && child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

