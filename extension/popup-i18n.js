// Browser UI language is authoritative until the user explicitly chooses a language.
globalThis.popupLocale = { selection: 'system', epoch: 0 };
function browserLanguage() { return chrome.i18n?.getUILanguage?.() || navigator.language || 'en'; }
function tr(en, zh) { return /^zh(?:[-_]|$)/i.test(popupLocale.selection === 'system' ? browserLanguage() : popupLocale.selection) ? zh : en; }
function applyPopupLanguage() {
  document.documentElement.lang = tr('en', 'zh-CN');
  document.title = tr('Chat On Steroids', '知行 · Chat On Steroids');
  for (const node of document.querySelectorAll('[data-zh]')) {
    node.dataset.en ??= node.textContent;
    node.textContent = tr(node.dataset.en, node.dataset.zh);
  }
  document.getElementById('languageSelect').value = popupLocale.selection;
}
applyPopupLanguage();
async function loadPopupLanguage() {
  const epoch = popupLocale.epoch;
  try {
    const saved = await chrome.storage.local.get('popupLanguage');
    if (epoch === popupLocale.epoch && ['system', 'en', 'zh-CN'].includes(saved.popupLanguage)) popupLocale.selection = saved.popupLanguage;
  } catch { /* Browser language remains usable if preference storage is unavailable. */ }
  applyPopupLanguage();
}
