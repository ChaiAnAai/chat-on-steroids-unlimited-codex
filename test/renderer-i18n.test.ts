import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { setUiLanguage, translate, t } from '../src/renderer/i18n.js';
import { translateMarkup } from '../src/renderer/i18n-static.js';
import { browserConnectionGuide } from '../src/renderer/connection-guide.js';
import { workflowDraft } from '../src/renderer/project-workflows.js';
import { setupStatusDetail } from '../src/renderer/setup-copy.js';
import type { AppState } from '../src/shared/types.js';

let dom: JSDOM | undefined;
it('translates dynamic tunnel status without changing unknown diagnostics', () => {
  const source = 'Connected. Last verified handshake with OpenAI 24s ago. Pick the tunnel in ChatGPT.';
  setUiLanguage('zh-CN');
  expect(setupStatusDetail(source)).toContain('24 秒前');
  expect(setupStatusDetail(source)).toContain('已连接');
  expect(setupStatusDetail('ECONNREFUSED /private/path')).toBe('ECONNREFUSED /private/path');
  setUiLanguage('en');
  expect(setupStatusDetail(source)).toBe(source);
});
afterEach(() => { setUiLanguage('en'); dom?.window.close(); vi.unstubAllGlobals(); });

it('distinguishes a failed browser service from a paired but disconnected extension', () => {
  const state = { bridge: { running: false, paired: false, present: false, startupIssue: 'ports-unavailable' } } as AppState;
  setUiLanguage('zh-CN');
  expect(browserConnectionGuide(state)).toContain('端口不可用');
  state.bridge = { ...state.bridge, startupIssue: null, running: true, paired: true };
  expect(browserConnectionGuide(state)).toContain('目前已离线');
  state.bridge.present = true;
  expect(browserConnectionGuide(state)).toContain('浏览器已连接');
});

it('appends workflow instructions to the exact existing draft and keeps review read-only', () => {
  setUiLanguage('zh-CN');
  const original = '修复按钮\n  保留缩进 /project';
  expect(workflowDraft(original, 'review')).toMatch(/^修复按钮\n  保留缩进 \/project\n\n/);
  expect(workflowDraft(original, 'review')).toContain('暂不修改文件');
  setUiLanguage('en');
  expect(workflowDraft('', 'implement')).toContain('existing build and test commands');
});

it('switches source markup both ways without replacing controls, icons or authored content', async () => {
  dom = new JSDOM(await readFile('src/renderer/index.html', 'utf8'));
  vi.stubGlobal('document', dom.window.document);
  const d = dom.window.document;
  const input = d.querySelector<HTMLTextAreaElement>('#chatInput')!;
  input.value = 'New chat /project NO_REPLY';
  input.focus();
  input.setSelectionRange(2, 5);
  const button = d.querySelector<HTMLButtonElement>('#newChat')!;
  const icon = button.querySelector('svg');
  const clicked = vi.fn(); button.addEventListener('click', clicked);
  const userMessage = d.createElement('p'); userMessage.textContent = 'New chat';
  d.querySelector('#timeline')!.append(userMessage);
  for (const language of ['zh-CN', 'en', 'zh-CN'] as const) {
    setUiLanguage(language); translateMarkup();
    expect(button.textContent?.trim()).toBe(language === 'zh-CN' ? '新任务' : 'New task');
    expect(d.documentElement.lang).toBe(language);
    expect(button.querySelector('svg')).toBe(icon);
    expect(input.value).toBe('New chat /project NO_REPLY');
    expect(input.selectionStart).toBe(2);
    expect(d.activeElement).toBe(input);
    expect(userMessage.textContent).toBe('New chat');
  }
  button.click(); expect(clicked).toHaveBeenCalledOnce();
  expect(d.querySelector('#addProject')?.getAttribute('aria-label')).toBe('添加项目文件夹');
});

it('translates dynamic text with safe literal interpolation and retains unknown identifiers', () => {
  setUiLanguage('zh-CN');
  expect(translate('Auto-compaction at {tokens} tokens', { tokens: '400,000' })).toBe('达到 400,000 Token 时自动压缩');
  expect(t('messageInProject', { project: '<img src=x>' })).toContain('<img src=x>');
  expect(translate('NO_REPLY')).toBe('NO_REPLY');
  setUiLanguage('en');
  expect(translate('New chat')).toBe('New chat');
});
