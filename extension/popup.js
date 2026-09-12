/**
 * Status UI, and the one place that answers "where did the stream stop?".
 *
 * Everything this browser observes has to survive three hand-offs before the desktop app
 * has it: this extension reads it off the page, the service worker delivers it, and the
 * app records it into a session for this chat. All three used to fail the same way from
 * here — nothing happens — so "Reaching the app" opens onto those three stages stated
 * separately, and names the one that did not complete.
 *
 * It opens itself when something is wrong and stays shut when nothing is, because a panel
 * that is always expanded is a panel nobody reads.
 */

const $ = (id) => document.getElementById(id);
const RENDER_STREAM_KEY = 'renderStreamEnabled';
const SHOW_TIMES_KEY = 'showStreamTimes';
const POLL_MS = 1500;

let overwriteEnabled = true;
let showTimes = false;
let latest = { status: null, tab: null };
let openedOnFailure = false;
let accountPairBusy = false;
let accountPairError = '';
let accountUiEpoch = 0;
let accountConfigLoaded = false;
let accountPairState = null;
function paintAccountPair(state) {
  if (!state || state.ok !== true) return;
  accountPairState = state;
  if (!accountConfigLoaded && state.configuration && !$('accountConfiguration').value) $('accountConfiguration').value = JSON.stringify(state.configuration);
  accountConfigLoaded = true;
  const seconds = state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)) : 0;
  $('accountFindBtn').disabled = accountPairBusy || state.pending;
  $('accountRequestBtn').disabled = accountPairBusy || state.pending;
  $('accountClaimBtn').disabled = accountPairBusy || !state.pending || seconds === 0;
  $('accountRecheckBtn').disabled = accountPairBusy || !state.configuration;
  $('accountPairStatus').textContent = accountPairError || (state.pending && seconds > 0
    ? tr(`Request ${String(state.requestId || '').slice(0, 8)} — confirm the matching code in the app. ${seconds}s remaining. Reopen this popup afterwards; pairing finishes automatically.`, `请求 ${String(state.requestId || '').slice(0, 8)}：请在知行核对编号并确认。剩余 ${seconds} 秒，之后重新打开此弹窗即可自动完成。`)
    : state.paired ? tr('Connected to the app. Login identity still needs verification; sync settings remain available.', '已连接知行；登录身份仍待确认，但同步设置可以使用。')
      : seconds === 0 && state.expiresAt ? tr('Pairing expired. Find the app and try again.', '配对已过期，请重新查找知行并连接。') : tr('Waiting for a connection invitation. Pairing does not start tasks.', '等待连接邀请。配对不会自动启动任务。'));
}
async function accountPairAction(type, extra = {}) {
  if (accountPairBusy) return;
  const epoch = ++accountUiEpoch; accountPairBusy = true; accountPairError = '';
  for (const id of ['accountRequestBtn', 'accountClaimBtn', 'accountRecheckBtn']) $(id).disabled = true;
  $('accountPairStatus').textContent = tr('Working…', '正在处理…');
  try {
    const value = $('accountConfiguration').value.trim();
    const result = await chrome.runtime.sendMessage({ type, ...extra, ...(type === 'account_pair_request' && value ? { configuration: value } : {}) });
    if (epoch !== accountUiEpoch) return;
    if (!result?.ok) { accountPairError = pairErrorText(result); }
    else accountPairState = result;
  } catch { if (epoch === accountUiEpoch) accountPairError = tr('Extension background unavailable. Retry or reload the extension.', '扩展后台未响应，请重试或重新加载扩展。'); }
  finally {
    if (epoch === accountUiEpoch) {
      accountPairBusy = false;
      paintAccountPair(accountPairState || { ok: true });
    }
  }
}
$('accountRequestBtn').addEventListener('click', () => void accountPairAction('account_pair_request'));
$('accountClaimBtn').addEventListener('click', () => void accountPairAction('account_pair_status'));
$('accountRecheckBtn').addEventListener('click', () => void accountPairAction('account_pair_recheck'));

$('accountFindBtn').addEventListener('click', async () => {
  if (accountPairBusy) return;
  const epoch = ++accountUiEpoch; accountPairBusy = true; $('accountFindBtn').disabled = true;
  const box = $('accountCandidates'); box.replaceChildren();
  $('accountPairStatus').textContent = tr('Finding the app…', '正在查找知行…');
  try {
    const found = await chrome.runtime.sendMessage({ type: 'account_pair_discover' });
    if (epoch !== accountUiEpoch) return;
    for (const row of found?.candidates || []) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${row.displayName} · ${row.configuration.browser} · ${row.configuration.port >= 18765 && row.configuration.port <= 18769 ? tr('Preview', '测试版') : tr('App', '应用')}`;
      button.onclick = () => { box.replaceChildren(); void accountPairAction('account_pair_connect', { setupId: row.setupId, port: row.configuration.port }); };
      box.append(button);
    }
    accountPairError = box.children.length ? tr('Select the account you just prepared in the app.', '请选择刚在知行中准备连接的账号。') : tr('No invitation found. In the latest app, open Accounts and click Connect extension, then try again within two minutes.', '未找到连接邀请。请在最新版知行的账号管理中点“连接扩展”，两分钟内再试。'); $('accountPairStatus').textContent = accountPairError;
  } catch { $('accountPairStatus').textContent = tr('Could not find the app. Keep it open and try again.', '查找失败，请保持知行运行后重试。'); }
  finally { if (epoch === accountUiEpoch) { accountPairBusy = false; $('accountFindBtn').disabled = false; } }
});
function pairErrorText(result) {
  const errors = {
    invalid_account_configuration: ['Invalid manual configuration. Copy it from the app’s advanced connection details.', '手动配置格式不正确，请从知行的高级连接信息中复制。'],
    account_profile_already_bound: ['This profile belongs to another account. Use the matching browser profile.', '此个人资料已绑定其他账号，请打开对应的浏览器个人资料。'],
    app_not_found: ['App unavailable. Keep the selected app open and retry.', '无法连接知行，请保持对应的程序运行后重试。'],
    incompatible_extension: ['Versions do not match. Reload the companion shipped with this app.', '版本不匹配，请加载当前知行附带的扩展。'],
    pairing_pending_or_invalid: ['Confirm the matching request in the app; an expired request needs a new invitation.', '请在知行中确认对应请求；请求过期后需要重新发起连接邀请。'],
    pairing_expired: ['Pairing expired. Prepare a new invitation in the app.', '配对已过期，请在知行中重新点击“连接扩展”。'],
    pairing_stale: ['The connection changed. Check the selected account and retry.', '连接已变更，请检查所选账号后重试。'],
    account_recheck_required: ['Reconnect the saved account in the app, then check again here.', '请先在知行中重连该账号，再检查已保存连接。']
  };
  return tr(...(errors[result?.error] || ['Connection failed. Configuration is retained; check the app and retry.', '连接失败，配置已保留，请检查知行后重试。']));
}

// ------------------------------------------------------------------ formatting

/** Ids are long and only their ends identify them, so keep both ends rather than one. */
function shorten(value, keep = 6) {
  const text = String(value || '');
  if (text.length <= keep + 5) return text;
  return `${text.slice(0, keep)}…${text.slice(-4)}`;
}

function ago(at) {
  if (!at) return '';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** One capture row: ok, no, wait or off, plus whatever it wants to say on the right. */
function row(name, state, meta) {
  $(`r-${name}`).className = `row ${state}`;
  const value = $(`d-${name}`);
  value.textContent = meta === null || meta === undefined ? '' : meta;
}

function idRow(name, state, meta, full) {
  row(name, state, meta);
  const value = $(`d-${name}`);
  value.title = full || '';
  value.disabled = !full;
}

function stage(name, state, meta) {
  $(`s-${name}`).className = `stage ${state}`;
  $(`n-${name}`).textContent = meta || '';
}

// -------------------------------------------------------------------- pipeline

/** How the app describes what it placed a call on, in its own words. */
function attribution(key) { return {
  request_id: tr("exact request id", "精确请求编号"),
  unattributed: tr("request id not resolved", "请求编号未解析"),
  agent: tr("agent key", "智能体标识"),
  turn: tr("tool block on the page", "页面工具记录"),
  generation: tr("the only chat generating", "唯一正在生成的对话"),
  inferred: tr("not placed in a chat", "未关联对话")
}[key]; }

/**
 * The three stages, from evidence each layer produced independently.
 *
 * Deliberately not one flag set by whoever ran last: "picked up" is the page's own count,
 * "sent to app" is the service worker's delivery log, and "app processed" is the app
 * naming a session for this chat on the feed the page polls. A stage is only green when
 * the layer that owns it said so.
 */
function pipeline(info, ready) {
  const page = info && info.page;
  const sent = info && info.delivery;
  const pending = info ? info.pending : 0;
  const read = page ? page.events : 0;

  if (!info || !info.isChat) return { read: ['off'], sent: ['off'], proc: ['off'], why: ['', ''] };
  if (!info.recorder) {
    return { read: ['failed'], sent: ['off'], proc: ['off'], why: ['bad', tr("No recorder in this tab. Reload the page.", "此标签页未加载同步组件，请刷新页面。")] };
  }
  if (read === 0) {
    return { read: ['running'], sent: ['off'], proc: ['off'], why: ['', tr("Waiting for the first message.", "等待第一条消息。")] };
  }

  const readStage = ['done', String(read)];
  if (!ready) {
    return {
      read: readStage,
      sent: ['failed', pending ? tr(`${pending} held`, `${pending} 条待同步`) : ''],
      proc: ['off'],
      why: ['bad', tr("Delivery is blocked until the app is connected and protocol compatibility is confirmed.", "尚未连接或版本不匹配，消息同步已暂停。")]
    };
  }
  if (sent && sent.ok === false) {
    return {
      read: readStage,
      sent: ['failed', String(sent.error || 'failed')],
      proc: ['off'],
      why: ['bad', tr(`The app rejected the last delivery (${sent.error || 'failed'}).`, `知行拒绝了最近一次同步（${sent.error || '失败'}）。`)]
    };
  }
  // Refused by the extension itself, before anything could be queued for the app. `pending`
  // counts only what the service worker already owns, so a document it is rejecting outright
  // reported nothing pending and this drawer went on to say "Delivered" — which is what it
  // said all through the 2026-08-21 blackout while the tab was reading ChatGPT perfectly and
  // sending none of it. The page is the only layer that knows, so it is the layer that says so.
  if (page.blocked) {
    return {
      read: readStage,
      sent: ['failed', page.queued ? tr(`${page.queued} held in page`, `页面保留 ${page.queued} 条`) : String(page.blocked)],
      proc: ['off'],
      why: [
        'bad',
        tr(`The extension is not accepting this tab’s observations (${String(page.blocked)}). Reload the ChatGPT tab.`, `扩展未接收此标签页的数据（${String(page.blocked)}），请刷新 ChatGPT 标签页。`)
      ]
    };
  }
  if (pending > 0) {
    return {
      read: readStage,
      sent: ['running', tr(`${pending} queued`, `${pending} 条排队中`)],
      proc: ['off'],
      why: ['', tr("Queued here. Retrying delivery to the app.", "消息已在本地排队，正在重试同步到知行。")]
    };
  }

  if (!page.session) {
    return {
      read: readStage,
      sent: ['running'],
      proc: ['running'],
      // The worker's delivery counters cover every tab. Only the page's session
      // receipt proves that this particular chat reached the app.
      why: ['', tr("App reachable. Waiting for this chat’s session receipt.", "可以连接知行，正在等待当前对话的接收确认。")]
    };
  }
  const sentStage = ['done', sent && sent.total ? String(sent.total) : ''];

  const calls = Array.isArray(page.trace) ? page.trace : [];
  const placed = calls.filter((call) => call.app === 'request_id').length;
  const missed = calls.filter((call) => call.app && call.app !== 'request_id');
  if (missed.length > 0) {
    return {
      read: readStage,
      sent: sentStage,
      proc: ['failed', `${placed}/${calls.length}`],
      why: [
        'bad',
        tr(`The app could not place ${missed.length === 1 ? 'a call' : `${missed.length} calls`} by request id — it fell back to ${attribution(missed[0].app) || missed[0].app}.`, `有 ${missed.length} 次调用未能按请求编号匹配，使用了${attribution(missed[0].app) || missed[0].app}归因。`)
      ]
    };
  }
  return {
    read: readStage,
    sent: sentStage,
    proc: ['done', calls.length ? `${placed}/${calls.length}` : ''],
    why: ['', calls.length ? tr("Every tool call matched end to end.", "所有工具调用均已完成两端匹配。") : tr("Recording into the app.", "正在同步到知行。")]
  };
}

/** One row per request id: three dots, the tool, the id. Newest first. */
function paintCalls(page) {
  const box = $('calls');
  box.textContent = '';
  const rows = page && Array.isArray(page.trace) ? page.trace.slice(0, 5) : [];
  for (const entry of rows) {
    const line = document.createElement('div');
    line.className = 'call';
    const pips = document.createElement('span');
    pips.className = 'pips';
    for (const state of [
      entry.read ? 'on' : '',
      entry.sent ? 'on' : '',
      entry.app ? (entry.app === 'request_id' ? 'on' : 'bad') : ''
    ]) {
      const pip = document.createElement('span');
      pip.className = `pip ${state}`;
      pips.append(pip);
    }
    const tool = document.createElement('span');
    tool.className = 'tool';
    tool.textContent = entry.tool || tr("tool call", "工具调用");
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = shorten(entry.requestId, 5);
    line.title = `${entry.requestId} — picked up ${entry.read ? 'yes' : 'no'} · sent ${entry.sent ? 'yes' : 'no'} · app ${attribution(entry.app) || tr("no record", "无记录")}`;
    line.append(pips, tool, id);
    box.append(line);
  }
}

// ------------------------------------------------------------------- rendering

function paintHeader(status) {
  const connected = status && status.connected === true;
  const paired = status && status.paired === true;
  const incompatible = connected && status.compatible === false;
  const needsSetup = status && status.needsSetup === true;
  // Disconnected on purpose. This has to say so plainly rather than describing it as a
  // connection that has not finished yet, which is what it looked like back when the next
  // poll would silently undo it.
  const off = status && status.disconnected === true && !paired;
  const ready = connected && paired && !needsSetup && status.compatible === true;

  $('pill').className = `pill ${ready ? '' : incompatible ? 'bad' : 'off'}`;
  $('state').textContent = incompatible
    ? tr("Version mismatch", "版本不匹配")
    : needsSetup
      ? tr("Account setup required", "需要连接账号")
    : off
      ? tr("Disconnected", "已断开")
      : !connected
        ? tr("App not reachable", "无法连接知行")
        : ready
          // Health + pairing prove reachability, not the recorder/command flow.
          ? tr(`App reachable · Port ${status.port}`, `可连接知行 · 端口 ${status.port}`)
          : tr(`Port ${status.port} · connecting`, `端口 ${status.port} · 正在连接`);

  $('retryBtn').hidden = ready || incompatible || needsSetup;
  $('retryBtn').textContent = off ? tr("Connect", "连接") : tr("Try again", "重试");
  $('unpairBtn').hidden = !paired || incompatible;
  return ready;
}

function paintAlert(status, info) {
  const page = info && info.page;
  const incompatible = status && status.connected === true && status.compatible === false;
  const pairError = status && status.pairError;
  const error = page && page.lastError;
  const text = incompatible
    ? tr(`App v${status.appVersion || '?'} (protocol ${status.appProtocol ?? '?'}); companion v${status.extensionVersion || '?'} (protocol ${status.extensionProtocol ?? '?'}). Open your browser's Extensions page, enable Developer mode, then Update / Reload this companion. If the mismatch remains, use Open extension folder in Chat On Steroids and load that folder. Reload ChatGPT tabs when their active work is finished.`, `应用 v${status.appVersion || '?'}（协议 ${status.appProtocol ?? '?'}），扩展 v${status.extensionVersion || '?'}（协议 ${status.extensionProtocol ?? '?'}）。请在浏览器扩展管理页开启开发者模式并重新加载扩展；仍不匹配时，在知行中打开扩展文件夹并加载该目录。当前工作结束后再刷新 ChatGPT 页面。`)
    : pairError && pairError.message
      ? pairErrorText(pairError)
      : pairError && pairError.error === 'secure_storage_unavailable'
        ? 'Secure credential storage is unavailable. Open Chat On Steroids for setup instructions.'
    : error && Date.now() - error.at < 10 * 60 * 1000
      ? error.text
      : '';
  $('alert').textContent = text;
  $('alert').hidden = !text;
}

function detail(list, term, value, bad) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  if (bad) dd.className = 'bad';
  dd.title = dd.textContent;
  list.append(dt, dd);
}

/**
 * Only what changes the reading of the three stages.
 *
 * An earlier draft of this drawer listed twenty-eight fields, which is a different thing
 * from being informative: nothing in it told you which layer had stopped.
 */
function paintDetails(status, info) {
  if (!$('more').open) return;
  const grid = $('grid');
  grid.textContent = '';
  const page = info && info.page;
  const sent = info && info.delivery;

  detail(grid, tr('app', '应用'), status ? `v${status.appVersion || '?'} · port ${status.port || '—'}` : null);
  detail(
    grid,
    tr('extension', '扩展'),
    status ? `v${status.extensionVersion} · protocol ${status.extensionProtocol}` : null,
    status && status.compatible === false
  );
  detail(grid, tr("chat id", "对话编号"), (info && info.conversationId) || null);
  detail(grid, tr("app session", "本地会话"), (page && page.session) || null, Boolean(page && !page.session));
  detail(grid, tr('tab', '标签页'), info ? `${info.tab} · epoch ${info.epoch ?? '—'}` : null);
  detail(
    grid,
    tr("ownership", "归属"),
    info ? (info.terminal ? tr('retired', '已停用') : info.bound ? tr('bound', '已绑定') : tr('unbound', '未绑定')) : null,
    Boolean(info && info.terminal)
  );
  detail(grid, tr('recorder', '同步组件'), page ? `fiber v${page.recorderVersion} · run ${page.runId}` : tr("not attached", "未加载"), !page);
  detail(grid, tr('turn', '轮次'), page ? (page.generating ? `${shorten(page.turnId, 8)} · ${tr('live', '运行中')}` : tr('idle', '空闲')) : null);
  detail(grid, tr("observed", "已观测"), page ? tr(`${page.events} events · ${page.calls} calls`, `${page.events} 个事件 · ${page.calls} 次调用`) : null);
  detail(
    grid,
    tr("in this browser", "本浏览器待同步"),
    info ? tr(`${info.pending} held · ${info.pendingAll} total`, `当前 ${info.pending} 条 · 共 ${info.pendingAll} 条`) : null,
    Boolean(info && info.pendingAll)
  );
  detail(
    grid,
    tr("last delivery", "最近同步"),
    sent && sent.at ? `${sent.ok ? 'ok' : sent.error || 'failed'} · ${sent.events} · ${ago(sent.at)} ago` : null,
    Boolean(sent && sent.ok === false)
  );
  detail(grid, tr("delivered", "累计同步"), sent ? sent.total : null);
  detail(grid, tr("page sends", "页面发送"), page ? tr(`${page.sends} · ${page.failures} failed`, `${page.sends} 次 · ${page.failures} 次失败`) : null, Boolean(page && page.failures));
}

async function refresh() {
  const epoch = accountUiEpoch;
  const [status, info, account] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'status' }),
    chrome.runtime.sendMessage({ type: 'tabStatus' }).catch(() => null),
    chrome.runtime.sendMessage({ type: 'account_pair_status' }).catch(() => null)
  ]);
  if (!accountPairBusy && epoch === accountUiEpoch) {
    if (account?.ok === false) { accountPairError = pairErrorText(account); paintAccountPair(accountPairState || { ok: true }); }
    else { if (account?.paired) accountPairError = ''; paintAccountPair(account); }
  }
  latest = { status, tab: info };

  const ready = paintHeader(status);
  const isChat = Boolean(info && info.isChat);
  const page = info && info.page;

  row('tab', isChat ? 'ok' : 'off', isChat ? '' : tr("none open", "未打开"));
  row('rec', !isChat ? 'off' : info.recorder ? 'ok' : 'no', !isChat ? '' : info.recorder ? (page.generating ? tr("answering", "正在回答") : '') : tr("reload", "请刷新"));

  const chatId = info && info.conversationId;
  idRow('chat', !isChat ? 'off' : chatId ? 'ok' : 'wait', !isChat ? '' : chatId ? shorten(chatId, 8) : tr("new chat", "新对话"), chatId);

  const requestId = page && page.requestId;
  idRow('req', !isChat ? 'off' : requestId ? 'ok' : 'wait', !isChat ? '' : requestId ? shorten(requestId, 9) : tr("none yet", "尚无"), requestId);

  const state = pipeline(info, ready);
  stage('read', ...state.read);
  stage('sent', ...state.sent);
  stage('proc', ...state.proc);
  $('why').textContent = state.why[1];
  $('why').className = `why ${state.why[0]}`;
  paintCalls(page);

  const broken = state.why[0] === 'bad';
  const flowing = state.proc[0] === 'done';
  row(
    'app',
    !isChat ? 'off' : broken ? 'no' : flowing ? 'ok' : 'wait',
    !isChat ? '' : broken ? tr('blocked', '已暂停') : flowing ? ago(info.delivery && info.delivery.at) || tr('live', '运行中') : tr('waiting', '等待中')
  );
  // Opens itself the first time something is actually wrong, so the panel that explains
  // the failure is already open when the popup is opened to look at one.
  if (broken && !openedOnFailure) {
    openedOnFailure = true;
    $('stream').open = true;
  }

  paintAlert(status, info);
  paintDetails(status, info);
}

// -------------------------------------------------------------------- controls

function syncOverwrite() {
  $('overwriteToggle').checked = overwriteEnabled;
}

async function loadPreferences() {
  const stored = await chrome.storage.local.get([RENDER_STREAM_KEY, SHOW_TIMES_KEY]);
  overwriteEnabled = stored[RENDER_STREAM_KEY] !== false;
  showTimes = stored[SHOW_TIMES_KEY] === true;
  syncOverwrite();
  $('timeToggle').checked = showTimes;
}

/** Puts one value on the clipboard and says so in place, without moving anything. */
async function copyInto(button, text) {
  if (!text) return;
  const was = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = tr("copied", "已复制");
  } catch {
    button.textContent = tr("copy failed", "复制失败");
  }
  setTimeout(() => {
    if (button.textContent === tr("copied", "已复制") || button.textContent === tr("copy failed", "复制失败")) button.textContent = was;
  }, 900);
}

for (const id of ['d-chat', 'd-req']) {
  $(id).addEventListener('click', (event) => {
    event.preventDefault();
    void copyInto(event.currentTarget, event.currentTarget.title);
  });
}

$('copyBtn').addEventListener('click', (event) => {
  const cells = [...$('grid').children].map((node) => node.textContent);
  const lines = [$('why').textContent];
  for (let index = 0; index < cells.length; index += 2) lines.push(`${cells[index]}: ${cells[index + 1]}`);
  void copyInto(event.currentTarget, lines.join('\n'));
});

$('more').addEventListener('toggle', () => paintDetails(latest.status, latest.tab));

$('reloadBtn').addEventListener('click', () => {
  // The old worker may be stuck: this explicit action belongs to the popup itself.
  chrome.runtime.reload();
});

$('retryBtn').addEventListener('click', async () => {
  if (latest.status?.needsSetup) return;
  $('retryBtn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'pair' });
  $('retryBtn').disabled = false;
  await refresh();
});

$('unpairBtn').addEventListener('click', async () => {
  accountUiEpoch++; accountPairBusy = false; accountPairError = '';
  await chrome.runtime.sendMessage({ type: 'unpair' });
  await refresh();
});

$('overwriteToggle').addEventListener('change', async () => {
  const previous = overwriteEnabled;
  overwriteEnabled = $('overwriteToggle').checked === true;
  syncOverwrite();
  try {
    await chrome.storage.local.set({ [RENDER_STREAM_KEY]: overwriteEnabled });
    // The toggle is the action. Enabling it immediately pulls the latest app timeline into
    // every known ChatGPT tab; there is deliberately no second "Overwrite now" button.
    if (overwriteEnabled) await chrome.runtime.sendMessage({ type: 'overwriteNow' });
  } catch {
    overwriteEnabled = previous;
    syncOverwrite();
  }
});

$('timeToggle').addEventListener('change', async () => {
  showTimes = $('timeToggle').checked === true;
  await chrome.storage.local.set({ [SHOW_TIMES_KEY]: showTimes });
});

// A popup is open for seconds at a time and the three stages move within those seconds.
void loadPopupLanguage().then(() => { paintAccountPair(accountPairState || { ok: true }); return refresh(); }).catch(() => undefined);
void loadPreferences().catch(() => undefined);
setInterval(() => void refresh().catch(() => undefined), POLL_MS);

$('languageSelect').addEventListener('change', async () => {
  const selected = $('languageSelect').value;
  if (!['system', 'en', 'zh-CN'].includes(selected)) return;
  popupLocale.epoch++; popupLocale.selection = selected; accountPairError = ''; applyPopupLanguage(); paintAccountPair(accountPairState || { ok: true });
  try { await chrome.storage.local.set({ popupLanguage: selected }); }
  catch { $('accountPairStatus').textContent = tr('Language preview applied but not saved. Please try again.', '语言已预览但未保存，请重试。'); return; }
  await refresh().catch(() => undefined);
});
