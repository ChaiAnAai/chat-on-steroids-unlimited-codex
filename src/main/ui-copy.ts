import { getConfig } from './config.js';
import { LOCALES } from '../renderer/locales/index.js';

const zh: Record<string, string> = {
  Connected: '已连接', 'No internet': '网络不可用', 'Not connected': '未连接',
  Open: '打开窗口', Disconnect: '断开连接', Connect: '连接', Quit: '退出应用'
};
export function translateMain(text: string): string {
  const language = getConfig().ui.language ?? 'en';
  return language === 'zh-CN' ? zh[text] ?? text : LOCALES[language]?.[text] ?? text;
}
