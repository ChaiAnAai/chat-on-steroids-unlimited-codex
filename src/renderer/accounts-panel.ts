import type { AccountManagementRequest, AccountManagementResult, AccountManagementSnapshot, ExistingBrowserProfile } from '../shared/accounts.js';

export interface AccountsPanelDependencies {
  manage: (request: AccountManagementRequest) => Promise<AccountManagementResult>;
  language: () => 'en' | 'zh-CN';
}
/** Explicit account management. Credentials and redeemable pairing nonces never enter this UI. */
export function mountAccountsPanel(container: HTMLElement, deps: AccountsPanelDependencies) {
  const root = document.createElement('section'); root.className = 'accounts-panel'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Accounts / 账号');
  const text = (en: string, zh: string) => deps.language() === 'zh-CN' ? zh : en;
  const heading = document.createElement('h2');
  const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.className = 'btn accounts-close';
  const gate = document.createElement('p'); gate.className = 'accounts-gate';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const form = document.createElement('form'); form.className = 'accounts-create';
  const label = document.createElement('label');
  const name = document.createElement('input'); name.maxLength = 160; name.required = true; name.autocomplete = 'off';
  const browserLabel = document.createElement('label'); const browser = document.createElement('select');
  for (const value of ['chrome', 'edge']) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'chrome' ? 'Chrome' : 'Edge'; browser.append(option); }
  const create = document.createElement('button'); create.type = 'submit'; create.className = 'btn';
  const profileLabel = document.createElement('label'); profileLabel.className = 'accounts-profile-choice';
  const profileCaption = document.createElement('span'); const profile = document.createElement('select');
  const profileHint = document.createElement('p'); profileHint.className = 'accounts-profile-hint';
  profileLabel.append(profileCaption, profile); let availableProfiles: ExistingBrowserProfile[] = [];
  const refreshButton = document.createElement('button'); refreshButton.type = 'button'; refreshButton.className = 'btn';
  const list = document.createElement('div'); list.className = 'accounts-list';
  label.append(name); browserLabel.append(browser); form.append(label, browserLabel, profileLabel, profileHint, create);
  root.append(heading, closeButton, gate, form, refreshButton, status, list); container.append(root);
  let alive = true, busy = false, generation = 0;
  let pairingWatchUntil = 0;
  let pairingSnapshot = '';
  let pairingPoll: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  let previousFocus: HTMLElement | null = null;
  const inertBefore = new Map<HTMLElement, boolean>();
  function labels() {
    heading.textContent = text('Browser accounts', '浏览器账号'); closeButton.textContent = text('Close', '关闭');
    gate.textContent = text('Parallel execution has not completed acceptance testing. Login verification and task routing are still being completed; task activation is unavailable.', '并行执行尚未完成验收。登录核验与任务路由仍在完善，任务启动暂不可用。');
    name.setAttribute('aria-label', text('Local display name (not login identity)', '本地名称（不是登录身份）'));
    name.placeholder = text('Local display name', '本地名称'); browser.setAttribute('aria-label', text('Browser', '浏览器'));
    create.textContent = text('Add account', '添加账号'); refreshButton.textContent = text('Check pairing requests', '检查配对请求');
    profileCaption.textContent = text('Browser profile', '浏览器个人资料');
    profile.setAttribute('aria-label', profileCaption.textContent);
    profileHint.textContent = text('Reuse an existing profile to keep its login. Profile names do not confirm ChatGPT identity; each profile needs its own extension pairing.', '接入已有个人资料可保留登录状态。资料名称不代表 ChatGPT 身份，每个资料仍需单独配对扩展。');
  }
  function profileOptions() {
    const previous = profile.value; profile.replaceChildren();
    const managed = document.createElement('option'); managed.value = ''; managed.textContent = text('Create a dedicated profile', '新建专用个人资料'); profile.append(managed);
    for (const row of availableProfiles.filter(row => row.browser === browser.value)) {
      const option = document.createElement('option'); option.value = row.directory;
      option.textContent = text('Use existing: ', '接入已有：') + `${row.displayName} (${row.directory})`; profile.append(option);
    }
    if (previous && ![...profile.options].some(option => option.value === previous)) {
      const missing = document.createElement('option'); missing.value = previous; missing.textContent = `${previous} · ${text('unavailable — select another profile', '不可用，请重新选择')}`; profile.append(missing);
    }
    profile.value = previous;
  }
  function draw(snapshot: AccountManagementSnapshot) {
    pairingWatchUntil = Math.max(pairingWatchUntil, snapshot.setup?.expiresAt ?? 0);
    pairingSnapshot = JSON.stringify([snapshot.accounts, snapshot.pending, snapshot.setup]);
    availableProfiles = snapshot.existingProfiles ?? []; profileOptions();
    list.replaceChildren();
    for (const account of snapshot.accounts) {
      const card = document.createElement('article'); card.className = 'accounts-card';
      const title = document.createElement('h3'); title.textContent = account.displayName;
      const identity = document.createElement('p'); identity.textContent = account.identity ? text('Browser-reported identity: ', '浏览器报告的身份：') + account.identity.displayLabel : text('Login identity unknown — awaiting confirmation', '身份待重新确认（登录身份未知）');
      const state = document.createElement('p'); state.textContent = `${account.browser === 'chrome' ? 'Chrome' : 'Edge'} · ${account.connected ? text('Extension paired', '扩展已配对') : text('Disconnected', '未连接')} · ${account.paused ? text('Tasks paused', '任务已暂停') : text('Task activation unavailable', '任务启动不可用')}`;
      state.textContent += account.existingProfileDirectory ? ` · ${text('Existing profile', '已有个人资料')} ${account.existingProfileDirectory}` : ` · ${text('Dedicated profile', '专用个人资料')}`;
      const quota = document.createElement('p'); const usage = snapshot.quotas?.[account.id];
      quota.textContent = usage?.state === 'fresh' ? text('Quota remaining: ', '剩余额度：') + usage.rows.map(row => `${row.model} · ${row.remainingPercent === null ? text('unknown', '未知') : `${row.remainingPercent}%`}`).join(' / ')
        : usage?.state === 'stale' ? text('Quota unknown — last observation expired or belongs to an older connection.', '额度未知：上次观测已过期或属于旧连接。') : text('Quota unknown — no reliable account observation.', '额度未知：尚无可靠的账号观测。');
      if (usage?.state === 'fresh' && snapshot.quotaPolicy) {
        const remaining = usage.rows.flatMap(row => row.remainingPercent === null ? [] : [row.remainingPercent]);
        if (remaining.some(percent => percent <= snapshot.quotaPolicy!.reservePercent)) quota.textContent += text(' · A quota pool reached the local reserve; new automatic rounds using that pool pause.', ' · 有额度池已到达本地预留线，使用该额度池的新自动轮次将暂停。');
        else if (remaining.some(percent => percent <= snapshot.quotaPolicy!.warningPercent)) quota.textContent += text(' · Low quota warning.', ' · 剩余额度较低。');
      }
      const actions = document.createElement('div'); actions.className = 'accounts-actions';
      function action(en: string, zh: string, request: AccountManagementRequest) {
        const button = document.createElement('button'); button.className = 'btn'; button.type = 'button'; button.textContent = text(en, zh);
        button.onclick = () => { void operate(request); }; actions.append(button);
      }
      action('Connect extension', '连接扩展', { action: 'prepare-pairing', accountId: account.id });
      action('Open browser profile', '打开浏览器配置', { action: 'open', accountId: account.id });
      action('Reconnect saved pairing', '重连并重新确认身份', { action: 'reconnect', accountId: account.id });
      for (const pending of snapshot.pending.filter(row => row.accountId === account.id)) {
        const match = document.createElement('p'); match.textContent = text('Compare the extension request code before confirming: ', '确认前请核对扩展中的请求编号：') + pending.requestId.slice(0, 8); actions.append(match);
        action(`Confirm pairing ${pending.requestId.slice(0, 8)}`, `确认配对 ${pending.requestId.slice(0, 8)}`, { action: 'confirm', accountId: account.id, requestId: pending.requestId });
      }
      action('Pause tasks', '暂停任务', { action: 'pause', accountId: account.id });
      action('Disconnect', '断开连接', { action: 'disconnect', accountId: account.id });
      action('Remove entry (keep data)', '移除入口（保留数据）', { action: 'remove', accountId: account.id });
      const activate = document.createElement('button'); activate.type = 'button'; activate.className = 'btn'; activate.disabled = true; activate.dataset.permanentlyDisabled = 'true'; activate.textContent = text('Start tasks — not verified', '启动任务 · 尚未验收'); actions.append(activate);
      const guide = document.createElement('details'); guide.className = 'accounts-guide';
      const guideTitle = document.createElement('summary'); guideTitle.textContent = text('Set up this browser profile', '接入这个浏览器个人资料');
      const instructions = document.createElement('ol');
      for (const line of [
        text('Open this browser profile. In its extension manager, enable developer mode and load the extracted companion extension folder.', '打开此浏览器配置，在扩展管理页开启开发者模式，加载解压后的配套扩展目录。'),
        text('Click Connect extension here, then open the extension in this browser profile and click Find app. Select this account.', '在这里点“连接扩展”，再打开此浏览器个人资料中的扩展，点“查找知行”并选择这个账号。'),
        text('Compare the request code and confirm here. Reopen the extension to see pairing complete automatically.', '核对请求编号，在这里确认。重新打开扩展即可自动完成配对，无需再点“完成”。'),
        account.existingProfileDirectory ? text('The existing browser keeps its login. Confirm the intended ChatGPT account; pairing alone does not verify identity or start work.', '已有浏览器保留原登录状态，请核对当前 ChatGPT 账号。完成配对不代表身份已核验，也不会启动任务。') : text('Sign in through the dedicated browser. Pairing alone does not verify the ChatGPT identity or start work.', '在专用浏览器内登录。完成配对不代表 ChatGPT 身份已核验，也不会启动任务。')
      ]) { const item = document.createElement('li'); item.textContent = line; instructions.append(item); }
      const code = document.createElement('textarea'); code.readOnly = true; code.rows = 3;
      code.setAttribute('aria-label', text('Non-secret browser configuration', '浏览器连接配置（不含密钥）'));
      code.value = JSON.stringify({ accountId: account.id, profileRef: account.profileRef, browser: account.browser, ...(snapshot.bridgePort ? { port: snapshot.bridgePort } : {}) });
      code.onfocus = () => code.select();
      const advanced = document.createElement('details');
      const advancedTitle = document.createElement('summary'); advancedTitle.textContent = text('Advanced: manual configuration', '高级：手动连接配置');
      advanced.append(advancedTitle, code); guide.append(guideTitle, instructions, advanced);
      if (snapshot.setup?.accountId === account.id) {
        guide.open = true; const next = document.createElement('p');
        next.textContent = text('Ready for two minutes. Open this profile’s extension and select Find app. No configuration code is needed.', '连接邀请已准备好，有效期两分钟。打开此个人资料的扩展，点“查找知行”，不需要复制配置码。');
        guide.prepend(next);
      }
      card.append(title, identity, state, quota, actions, guide); list.append(card);
    }
    if (!snapshot.accounts.length) { const empty = document.createElement('p'); empty.textContent = text('Add a browser profile to begin. Opening it does not confirm login.', '添加浏览器配置以开始使用。打开浏览器并不代表已登录。'); list.append(empty); }
    create.disabled = snapshot.accounts.length >= 5;
    create.dataset.permanentlyDisabled = String(snapshot.accounts.length >= 5);
  }
  async function operate(request: AccountManagementRequest): Promise<void> {
    if (!alive || busy || root.hidden) return;
    const captured = ++generation; busy = true;
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) if (button !== closeButton) button.disabled = true;
    status.textContent = text('Working…', '正在处理…');
    try {
      const result = await deps.manage(request);
      if (!alive || captured !== generation) return;
      if (!result.ok) throw new Error(result.error);
      draw(result.data);
      if (request.action === 'create' && name.value === request.displayName) name.value = '';
      status.textContent = request.action === 'open' ? text('Browser launch requested. Login and pairing are still checked separately.', '已请求打开浏览器，登录与配对仍需分别确认。') : text('Updated', '已更新');
    } catch (error) {
      const known: Record<string, [string, string]> = {
        'Browser bridge is unavailable': ['The local bridge could not start. Close conflicting preview instances and retry.', '本地连接服务未能启动，请关闭冲突的测试版后重试。'],
        'Existing browser profile is unavailable': ['That profile is no longer available. Refresh and select it again; no other profile was opened.', '该个人资料当前不可用，请刷新后重新选择。未打开其他资料。'],
        'Browser profile already belongs to an account': ['This browser profile is already linked. Use its existing account entry.', '这个浏览器个人资料已接入，请使用已有的账号入口。'],
        'Account not found': ['This account entry was removed. Refresh the list.', '该账号入口已被移除，请刷新列表。'],
        'At most five accounts are supported': ['Five accounts already exist. Remove an unused entry before adding another.', '已有五个账号，请先移除不再使用的入口。'],
        'Pairing request has changed': ['The pairing request changed. Refresh and confirm the current request.', '配对请求已变化，请刷新后确认当前请求。'],
        'Pairing expired or superseded': ['Pairing expired. Request pairing again in the browser extension.', '配对已过期，请在浏览器扩展中重新发起配对。'],
        'Saved pairing is unavailable; pair this browser again': ['There is no usable saved pairing. Pair this browser through the extension first.', '没有可用的已保存配对，请先通过浏览器扩展完成配对。']
      };
      const message = error instanceof Error ? known[error.message] : undefined;
      if (alive && captured === generation) status.textContent = message ? text(...message) : text('The operation failed. Your input is retained. Check the connection and retry.', '操作失败，输入已保留。请检查连接后重试。');
    } finally {
      if (captured === generation) busy = false;
      if (alive && captured === generation) for (const button of root.querySelectorAll<HTMLButtonElement>('button')) button.disabled = button.dataset.permanentlyDisabled === 'true';
    }
  }
  async function pollPairing() {
    if (root.hidden || busy || polling || Date.now() >= pairingWatchUntil) return;
    const epoch = generation; polling = true;
    try {
      const result = await deps.manage({ action: 'list' });
      if (!alive || root.hidden || busy || epoch !== generation || !result.ok) return;
      const next = JSON.stringify([result.data.accounts, result.data.pending, result.data.setup]);
      if (next !== pairingSnapshot) {
        const focused = document.activeElement as HTMLElement | null;
        const caption = focused?.closest('.accounts-card') ? focused.textContent : null;
        draw(result.data);
        if (caption) [...list.querySelectorAll('button')].find(button => button.textContent === caption)?.focus();
      }
    } finally { polling = false; }
  }
  function close() {
    clearInterval(pairingPoll); pairingPoll = undefined;
    generation++; busy = false; root.hidden = true;
    for (const [element, inert] of inertBefore) element.inert = inert;
    inertBefore.clear();
    // Narrow navigation closes after opening this panel; its original entry is then inert.
    const returnFocus = previousFocus?.closest('[hidden], [inert]')
      ? document.getElementById('sidebarToggle') : previousFocus;
    returnFocus?.focus();
  }
  function open() {
    if (!root.hidden) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    for (const element of document.body.children) if (element instanceof HTMLElement && !element.contains(root)) {
      inertBefore.set(element, element.inert); element.inert = true;
    }
    root.hidden = false; pairingPoll = setInterval(() => { void pollPairing().catch(() => undefined); }, 1500); labels(); closeButton.focus(); void operate({ action: 'list' });
  }
  closeButton.onclick = close;
  refreshButton.onclick = () => { void operate({ action: 'list' }); };
  browser.onchange = () => { profile.value = ''; profileOptions(); };
  form.onsubmit = event => { event.preventDefault(); if (name.value.trim()) void operate({ action: 'create', displayName: name.value, browser: browser.value as 'chrome' | 'edge', ...(profile.value ? { existingProfileDirectory: profile.value } : {}) }); };
  root.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, details[open] textarea')]; const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  labels();
  return { open, close, refresh: () => operate({ action: 'list' }), destroy: () => { close(); alive = false; root.remove(); } };
}
