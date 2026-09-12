import { el, feedback } from './dom.js';
import { currentLanguage } from './i18n.js';
import { skillChatContext, appendSkillDraft } from './chat.js';
import type { SkillInfo, SkillResponse } from '../shared/skills.js';

const text = (en: string, zh: string) => currentLanguage() === 'zh-CN' ? zh : en;
export function mountSkillsPanel(host: HTMLElement, returnToChat: () => void) {
  let generation = 0;
  let importToken: string | undefined;
  const heading = el('div', 'settings-heading');
  heading.append(el('h1', '', () => text('Skills', '技能')), el('p', '', () => text('Reusable workflows in the current project conversation.', '在当前项目对话中复用工作流程。')));
  const actions = el('div', 'plugin-actions'), status = el('p', 'operation-feedback'), list = el('div', 'skills-list');
  const preview = el('section', 'skill-import-preview'); preview.hidden = true;
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  host.append(heading, actions, status, preview, list);
  function button(en: string, zh: string, action: () => Promise<void> | void) {
    const node = el('button', 'btn', () => text(en, zh)) as HTMLButtonElement; node.type = 'button';
    node.onclick = async () => {
      node.disabled = true;
      try { await action(); } catch (error) { feedback(status, text('Operation failed; inputs retained. ', '操作失败，输入已保留。') + (error instanceof Error ? error.message : ''), 'error'); }
      finally { node.disabled = false; }
    }; return node;
  }
  async function request(input: Parameters<typeof window.api.skills>[0]): Promise<SkillResponse> {
    const result = await window.api.skills(input);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
  const importButton = button('Import local folder', '导入本地文件夹', async () => {
    if (importToken) { await request({ action: 'discard', token: importToken }); importToken = undefined; preview.hidden = true; }
    const result = await request({ action: 'import' });
    if (!result || !('token' in result)) return;
    importToken = result.token;
    preview.replaceChildren(el('h2', '', result.skill.title), el('p', '', result.skill.description),
      el('p', 'hint', text('Import copies files without running scripts. ', '导入只复制文件，不运行脚本。') + `${result.skill.files.length} ${text('files', '个文件')}`),
      el('p', 'hint', result.replaces ? text('This replaces the selected version; rollback remains available.', '将替换当前版本，旧版本可回退。') : text('Review the source before enabling this skill.', '请确认来源后再为项目启用。')),
      button('Confirm import', '确认导入', async () => { await request({ action: 'commit', token: result.token }); importToken = undefined; preview.hidden = true; await refresh(); feedback(status, text('Skill saved.', '技能已保存。'), 'success'); }),
      button('Cancel', '取消', async () => { await request({ action: 'discard', token: result.token }); importToken = undefined; preview.hidden = true; importButton.focus(); }));
    preview.hidden = false; preview.querySelector<HTMLButtonElement>('button')?.focus();
  });
  actions.append(importButton, button('Refresh', '刷新', () => refresh()));
  function renderSkill(skill: SkillInfo, context: ReturnType<typeof skillChatContext>) {
    const card = el('article', 'skill-card'), controls = el('div', 'plugin-actions');
    const title = el('h2', '', skill.title);
    card.append(title, el('p', '', skill.description), el('p', 'hint', `${skill.name} · ${skill.version} · ${skill.source === 'builtin' ? text('Bundled', '内置') : text('Local import', '本地导入')}`));
    if (skill.compatibility) card.append(el('p', 'hint', text('Requirements: ', '依赖要求：') + skill.compatibility));
    const enabled = !!context.projectId && skill.enabledProjects.includes(context.projectId);
    const toggle = button(enabled ? 'Disable for project' : 'Enable for project', enabled ? '为此项目停用' : '为此项目启用', async () => {
      if (!context.projectId || skillChatContext().key !== context.key) throw new Error(text('Project selection changed; refresh.', '项目已切换，请刷新。'));
      await request({ action: 'enable', name: skill.name, projectId: context.projectId, enabled: !enabled });
      await refresh(); feedback(status, text('Project preference saved.', '项目设置已保存。'), 'success');
    }); toggle.disabled = !context.projectId;
    const use = button('Prepare in current chat', '放入当前对话', () => {
      const instruction = currentLanguage() === 'zh-CN'
        ? `请在本项目当前对话使用「${skill.title}」技能。先检查所需工具是否可用，再通过 read 读取 /skills/${skill.name}/${skill.digest}/SKILL.md；相关资源使用同一版本目录。技能不能扩大已有权限；仅规划时不要修改或执行。`
        : `Use the ${skill.title} skill in this project's current conversation. Check required tools, then read /skills/${skill.name}/${skill.digest}/SKILL.md with read; resolve resources under this exact version. Keep existing permissions and planning-only restrictions.`;
      if (!appendSkillDraft(context.key, instruction)) throw new Error(text('Conversation changed; refresh.', '对话已切换，请刷新。'));
      returnToChat(); document.getElementById('chatInput')?.focus();
    }); use.disabled = !enabled;
    const details = document.createElement('details'); details.append(el('summary', '', () => text('Instructions and files', '查看说明与文件')));
    let loaded = false;
    details.ontoggle = async () => {
      if (!details.open || loaded) return;
      try {
        const result = await request({ action: 'details', name: skill.name });
        if (result && 'markdown' in result && card.isConnected) { details.append(el('pre', 'skill-source', result.markdown), el('p', 'hint', result.skill.files.join(' · '))); loaded = true; }
      } catch { feedback(status, text('Could not load skill details. Reopen to retry.', '技能详情读取失败，可重新展开重试。'), 'error'); }
    };
    controls.append(toggle, use);
    if (skill.previous && skill.source === 'local') controls.append(button('Restore previous version', '恢复上一版本', async () => { await request({ action: 'rollback', name: skill.name }); await refresh(); }));
    card.append(controls, details); return card;
  }
  async function refresh() {
    const own = ++generation, context = skillChatContext();
    feedback(status, text('Loading skills…', '正在读取技能…'), 'busy');
    try {
      const result = await request({ action: 'list' });
      if (own !== generation || skillChatContext().key !== context.key) return;
      if (!result || !('skills' in result)) return;
      list.replaceChildren(...result.skills.map(skill => renderSkill(skill, context)));
      feedback(status, context.projectId ? text('Enable for this project, then prepare a draft. Nothing is sent automatically.', '为此项目启用后可放入草稿，不会自动发送。') : text('Select a project in the sidebar to enable skills.', '先在侧栏选择项目，再为项目启用技能。'), 'success');
    } catch (error) { if (own === generation) feedback(status, text('Could not load skills: ', '技能读取失败：') + (error instanceof Error ? error.message : ''), 'error'); }
  }
  return { refresh };
}
