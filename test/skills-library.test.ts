import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { SkillLibrary } from '../src/main/skills/library.js';
let root: string, library: SkillLibrary, source: string;
const project = randomUUID();
const markdown = (body: string) => `---\nname: sample-skill\ndescription: "A local skill"\nmetadata:\n  title: 示例技能\n  version: "1.0"\n---\n${body}`;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-skills-')); library = new SkillLibrary(path.join(root, 'managed')); source = path.join(root, 'sample-skill'); await fs.mkdir(source); await fs.writeFile(path.join(source, 'SKILL.md'), markdown('first')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it('installs three disabled builtins without granting project access', async () => {
  const rows = await library.list(); expect(rows).toHaveLength(3); expect(rows.every(row => !row.enabledProjects.length)).toBe(true);
  await expect(library.read(project, rows[0]!.name, rows[0]!.digest, 'SKILL.md')).rejects.toThrow('not enabled');
});
it('previews immutable content, keeps the old version available and rolls back after restart', async () => {
  const first = await library.preview(source); expect((await library.list()).length).toBe(3);
  await fs.writeFile(path.join(source, 'SKILL.md'), markdown('changed after preview'));
  await library.commit(first.token); await library.enable('sample-skill', project, true);
  expect(await library.read(project, 'sample-skill', first.skill.digest, 'SKILL.md')).toContain('first');
  const second = await library.preview(source); await library.commit(second.token);
  expect(await library.read(project, 'sample-skill', first.skill.digest, 'SKILL.md')).toContain('first');
  library = new SkillLibrary(path.join(root, 'managed')); await library.rollback('sample-skill');
  expect((await library.details('sample-skill')).skill.digest).toBe(first.skill.digest);
});
it('rejects stale replacement, cross-project reads and resource traversal', async () => {
  const first = await library.preview(source), stale = await library.preview(source); await library.commit(first.token);
  await expect(library.commit(stale.token)).rejects.toThrow('changed');
  await library.enable('sample-skill', project, true);
  await expect(library.read(randomUUID(), 'sample-skill', first.skill.digest, 'SKILL.md')).rejects.toThrow('not enabled');
  await expect(library.read(project, 'sample-skill', first.skill.digest, '../library.json')).rejects.toThrow('Invalid');
});
it('rejects links, oversized files and stored content modifications', async () => {
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(source, 'escape'), 'junction');
  await expect(library.preview(source)).rejects.toThrow('links');
  await fs.unlink(path.join(source, 'escape'));
  const first = await library.preview(source); await library.commit(first.token);
  await fs.writeFile(path.join(root, 'managed/objects', first.skill.digest, 'SKILL.md'), markdown('tampered'));
  await expect(library.details('sample-skill')).rejects.toThrow('integrity');
  await fs.writeFile(path.join(source, 'too-large'), Buffer.alloc(5 * 1024 * 1024));
  await expect(library.preview(source)).rejects.toThrow('5 MB');
});
