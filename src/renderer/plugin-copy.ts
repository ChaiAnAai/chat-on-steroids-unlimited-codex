import type { PluginField, PluginToolView } from '../shared/plugins.js';
import { currentLanguage, t } from './i18n.js';

export function pluginFieldLabel(field: PluginField): string {
  if (currentLanguage() !== 'zh-CN') return field.label;
  const key = field.key;
  if (/api.?key|token|secret|authorization/i.test(key)) return `访问凭据 · ${key}`;
  if (/password/i.test(key)) return `密码 · ${key}`;
  if (/url|endpoint/i.test(key)) return `服务地址 · ${key}`;
  if (/path|directory|folder|root/i.test(key)) return `文件或目录位置 · ${key}`;
  return t(field.label);
}
export function pluginFieldHint(field: PluginField, keepSaved = false): string {
  if (currentLanguage() !== 'zh-CN') return keepSaved && field.secret ? t('Leave empty to keep the saved credential.') : field.placeholder ?? '';
  const parts = [field.required ? '必填' : '选填'];
  if (field.secret) parts.push(keepSaved ? '留空保留已保存的凭据；由主进程安全保存' : '填写提供方的凭据；由主进程安全保存');
  if (/url|endpoint/i.test(field.key)) parts.push('填写提供方文档中的完整服务地址');
  if (/path|directory|folder|root/i.test(field.key)) parts.push('填写此服务要求的文件或目录位置');
  if (field.placeholder) parts.push(`发布者示例：${field.placeholder}`);
  if (pluginFieldLabel(field) !== field.label) parts.push(`原字段说明：${field.label}`);
  return parts.join('。');
}
export function pluginToolPurpose(tool: PluginToolView): string {
  if (currentLanguage() !== 'zh-CN') return tool.description || tool.exposedName;
  const name = tool.name;
  if (name === 'microsoft_docs_search') return '搜索微软官方技术文档。';
  if (name === 'microsoft_docs_fetch') return '读取微软文档页面的完整内容。';
  if (name === 'microsoft_code_sample_search') return '查找微软官方代码示例。';
  if (/search|find|query/i.test(name)) return '用途提示（按名称归类）：搜索或查询信息；具体输入和影响见原文。';
  if (/read|fetch|get|list/i.test(name)) return '用途提示（按名称归类）：获取或列出信息；名称不能保证没有写入影响。';
  if (/create|write|update|delete|send|remove/i.test(name)) return '用途提示（按名称归类）：可能创建、修改、发送或删除内容，请核对原文。';
  return '暂缺中文工具说明，请展开查看发布者原文。';
}
