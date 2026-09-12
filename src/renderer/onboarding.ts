import type { ProxyManagementRequest, ProxyManagementResult, ProxyManagementStatus } from '../shared/proxy-management.js';
import { el, feedback } from './dom.js';
import { currentLanguage, onLanguageChanged, ui } from './i18n.js';

const copy = (en: string, zh: string): string => currentLanguage() === 'zh-CN' ? zh : en;
const proxyError = (message: string): string => {
  if (currentLanguage() !== 'zh-CN') return message;
  const messages: Record<string, string> = {
    'Unknown proxy management action.': '无法识别该代理管理操作，请重新打开设置。',
    'Enter a valid proxy origin. Remote connections require HTTPS; local connections may use HTTP.': '请输入有效的代理服务地址。远程连接需要 HTTPS，本地连接可使用 HTTP；地址不能包含路径、密钥或查询参数。',
    'The credential is too long.': '密钥长度超出限制，请检查是否粘贴了其他内容。',
    'Choose a valid model.': '请选择有效的模型。',
    'The proxy model response is incompatible. Open diagnostics to inspect the service.': '代理返回的模型列表格式不兼容，请打开诊断页面检查服务。',
    'The proxy operation failed. Your existing connection settings remain available; check secure storage or service availability and retry.': '代理操作失败，已有连接配置仍可使用。请检查系统安全存储或服务状态后重试。'
  };
  return messages[message] ?? '代理操作失败，输入已保留。请检查连接后重试。';
};
export interface ConnectionGuideState {
  language: 'en' | 'zh-CN';
  workspaceReady: boolean;
  extensionReady: boolean;
  connectorReady: boolean;
  proxyEndpoint?: string;
}
export interface ConnectionGuideDependencies {
  snapshot: () => ConnectionGuideState;
  changeLanguage: (language: 'en' | 'zh-CN') => Promise<void>;
  navigate: (section: 'workspace' | 'extension' | 'connector') => void;
  proxy: (request: ProxyManagementRequest) => Promise<ProxyManagementResult>;
}

/** Setup is a read-only readiness projection until the user selects an explicit action. */
export function mountConnectionGuide(container: HTMLElement, deps: ConnectionGuideDependencies): { refresh: () => void; destroy: () => void } {
  const root = el('section', 'connection-guide');
  root.append(el('h2', 'connection-guide-title', () => copy('Connection overview', '连接概览')));
  let shownState = deps.snapshot();
  let alive = true;
  const button = (en: string, zh: string, action: () => void): HTMLButtonElement => {
    const node = el('button', 'btn', () => copy(en, zh)) as HTMLButtonElement;
    node.type = 'button'; node.onclick = action; return node;
  };
  const languageRow = el('div', 'connection-guide-language');
  const languageLabel = el('label', 'connection-guide-label');
  languageLabel.append(el('span', '', () => copy('Language', '语言')));
  const languageSelect = document.createElement('select'); languageSelect.className = 'connection-guide-language-select';
  for (const [value, title] of [['zh-CN', '简体中文'], ['en', 'English']]) {
    const option = document.createElement('option'); option.value = value!; option.textContent = title!; languageSelect.append(option);
  }
  ui(languageSelect, 'aria-label', () => copy('Language', '语言'));
  languageSelect.value = shownState.language; languageLabel.append(languageSelect);
  const languageStatus = el('span', 'connection-guide-language-status'); languageStatus.hidden = true;
  let languageBusy = false, languageDirty = false, languageSaved = false;
  const languageRetry = button('Retry', '重试', () => { void saveLanguage(); }); languageRetry.hidden = true;
  languageRow.append(languageLabel, languageStatus, languageRetry); root.append(languageRow);
  async function saveLanguage(): Promise<void> {
    if (languageBusy || !alive) return;
    const selected = languageSelect.value === 'zh-CN' ? 'zh-CN' : 'en';
    languageDirty = true; languageSaved = false; languageBusy = true; languageSelect.disabled = true; languageRetry.hidden = true;
    feedback(languageStatus, copy('Saving…', '保存中…'), 'busy');
    try {
      await deps.changeLanguage(selected);
      if (!alive) return;
      languageSaved = languageSelect.value === selected;
      feedback(languageStatus, copy('Saved', '已保存'), 'success');
    } catch {
      if (alive) { feedback(languageStatus, copy('Not saved. Your selection is retained.', '未保存，已保留当前选择。'), 'error'); languageRetry.hidden = false; }
    } finally {
      languageBusy = false;
      if (alive) { languageSelect.disabled = false; refresh(); }
    }
  }
  languageSelect.onchange = () => { void saveLanguage(); };
  const overview = el('div', 'connection-guide-overview'); root.append(overview);
  const rows: Array<{ row: HTMLElement; key: 'workspaceReady' | 'extensionReady' | 'connectorReady'; status: HTMLElement }> = [];
  function addRow(en: string, zh: string, key: 'workspaceReady' | 'extensionReady' | 'connectorReady', section: 'workspace' | 'extension' | 'connector', actionEn: string, actionZh: string) {
    const row = el('div', 'connection-guide-status-row'); row.dataset.section = section;
    const state = el('span', 'connection-guide-state');
    ui(state, 'textContent', () => shownState[key] ? copy('Ready', '已就绪') : copy('Needs setup', '待设置'));
    row.append(el('span', 'connection-guide-row-title', () => copy(en, zh)), state, button(actionEn, actionZh, () => deps.navigate(section)));
    overview.append(row); rows.push({ row, key, status: state });
  }
  addRow('Folder permissions', '文件夹权限', 'workspaceReady', 'workspace', 'Manage folders', '管理文件夹');
  addRow('Browser extension', '浏览器扩展', 'extensionReady', 'extension', 'Set up extension', '设置扩展');
  addRow('ChatGPT connector', 'ChatGPT 连接', 'connectorReady', 'connector', 'Manage connection', '管理连接');
  const proxy = el('details', 'connection-guide-proxy');
  proxy.append(el('summary', '', () => copy('Optional · CLIProxyAPI connection', '可选 · CLIProxyAPI 连接')));
  proxy.append(el('p', 'muted', () => copy('Connect an existing service. This does not change the ChatGPT conversation or enable planning assistants.', '连接已有服务，不会切换主对话的执行来源，也不会启用辅助规划会话。')));
  function input(en: string, zh: string, type = 'text'): HTMLInputElement {
    const label = el('label', 'connection-guide-proxy-field');
    label.append(el('span', '', () => copy(en, zh)));
    const field = document.createElement('input'); field.type = type;
    field.autocomplete = 'off'; field.spellcheck = false;
    label.append(field); proxy.append(label); return field;
  }
  const endpoint = input('Service address', '服务地址'); endpoint.value = deps.snapshot().proxyEndpoint ?? 'http://127.0.0.1:8317';
  const management = input('Management key', '管理密钥', 'password');
  const api = input('Proxy API key', '代理访问密钥', 'password');
  proxy.append(el('p', 'muted', () => copy('Leave a key blank to keep its saved value. Keys are stored by the operating system and are never included in status results.', '密钥留空会保留已保存的值。密钥通过系统安全存储保存，不会出现在状态结果中。')));
  const actions = el('div', 'connection-guide-actions'); proxy.append(actions);
  const proxyStatus = el('div'); proxyStatus.setAttribute('role', 'status'); proxy.append(proxyStatus);
  const modelLabel = el('label', 'connection-guide-proxy-field');
  modelLabel.append(el('span', '', () => copy('Available model', '可用模型')));
  const models = document.createElement('select'); models.disabled = true; modelLabel.append(models); proxy.append(modelLabel);
  let savedEndpoint = endpoint.value;
  let proxyBusy = false;
  const connectionCopy: Record<ProxyManagementStatus['connection'], [string, string]> = {
    'not-configured': ['Connection not checked. Save credentials, then check the connection.', '尚未检查连接。请保存密钥，然后检查连接。'],
    unreachable: ['Service unreachable. Start the existing service and verify its address.', '无法连接服务。请启动已有服务并核对地址。'],
    unauthorized: ['Credentials rejected or access blocked. Correct the credentials before checking again.', '密钥被拒绝或访问受限。请修正密钥后再检查。'],
    unavailable: ['The management API is unavailable. Check the installed service configuration.', '管理接口不可用，请检查已安装服务的配置。'],
    ready: ['Connection confirmed', '连接已确认']
  };
  async function proxyAction(request: ProxyManagementRequest): Promise<void> {
    if (proxyBusy || !alive) return;
    proxyBusy = true; proxy.setAttribute('aria-busy', 'true');
    for (const node of actions.querySelectorAll<HTMLButtonElement>('button')) node.disabled = true;
    feedback(proxyStatus, copy('Working…', '正在处理…'), 'busy');
    try {
      const result = await deps.proxy(request); if (!alive) return;
      if (!result.ok) { feedback(proxyStatus, proxyError(result.error), 'error'); return; }
      const data = result.data;
      if (request.action === 'configure') {
        if (request.managementKey !== undefined && management.value === request.managementKey) management.value = '';
        if (request.apiKey !== undefined && api.value === request.apiKey) api.value = '';
        savedEndpoint = data.endpoint;
      }
      const words = connectionCopy[data.connection];
      let message = request.action === 'configure' ? copy('Saved. Check the connection to confirm it is ready.', '已保存。请检查连接以确认服务就绪。')
        : request.action === 'open-console' ? copy('Diagnostics opened. Sign in there if needed; saved keys are not exposed to that page.', '已打开诊断页面。如需登录，请在该页面操作；应用保存的密钥不会暴露给该页面。') : copy(...words);
      message += ` · ${data.endpoint}`;
      if (data.version) message += ` · ${data.version}`;
      if (request.action === 'status') message += data.executable ? copy(' · Local installation found', ' · 已检测到本地安装') : copy(' · Local executable not found', ' · 未检测到本地可执行文件');
      feedback(proxyStatus, message, ['unauthorized', 'unavailable', 'unreachable'].includes(data.connection) ? 'error' : 'success');
      if (data.models) {
        models.replaceChildren(...data.models.map(id => { const option = document.createElement('option'); option.value = id; option.textContent = id; return option; }));
        models.disabled = data.models.length === 0;
        if (data.model && data.models.includes(data.model)) models.value = data.model;
      }
    } catch { if (alive) feedback(proxyStatus, copy('The proxy operation failed. Your input is retained; retry when the service is available.', '代理操作失败，输入已保留。服务恢复后可以重试。'), 'error'); }
    finally { proxyBusy = false; if (alive) { proxy.setAttribute('aria-busy', 'false'); for (const node of actions.querySelectorAll<HTMLButtonElement>('button')) node.disabled = false; } }
  }
  actions.append(button('Save connection', '保存连接', () => { void proxyAction({ action: 'configure', endpoint: endpoint.value,
    ...(management.value ? { managementKey: management.value } : {}), ...(api.value ? { apiKey: api.value } : {}) }); }));
  actions.append(button('Check connection', '检查连接', () => { void proxyAction({ action: 'status' }); }));
  actions.append(button('Discover models', '发现模型', () => { void proxyAction({ action: 'models' }); }));
  actions.append(button('Open diagnostics', '打开诊断', () => { void proxyAction({ action: 'open-console' }); }));
  actions.append(button('Save model', '保存模型', () => {
    if (models.value) void proxyAction({ action: 'configure', endpoint: savedEndpoint, model: models.value });
  }));
  root.append(proxy); container.append(root);
  function refresh(): void {
    if (!alive) return;
    shownState = deps.snapshot();
    if (languageSaved && shownState.language === languageSelect.value) { languageDirty = false; languageSaved = false; }
    if (!languageDirty && !languageBusy) languageSelect.value = shownState.language;
    for (const { row, key, status } of rows) {
      row.dataset.ready = String(shownState[key]);
      ui(status, 'textContent', () => shownState[key] ? copy('Ready', '已就绪') : copy('Needs setup', '待设置'));
    }
    root.dataset.ready = String(shownState.workspaceReady && shownState.extensionReady && shownState.connectorReady);
  }
  refresh();
  const unsubscribeLanguage = onLanguageChanged(refresh);
  return { refresh, destroy: () => { alive = false; unsubscribeLanguage(); root.remove(); } };
}
