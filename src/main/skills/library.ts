import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { load, FAILSAFE_SCHEMA } from 'js-yaml';
import { z } from 'zod';
import type { SkillInfo, SkillImportPreview } from '../../shared/skills.js';
import { builtinSkills } from './builtins.js';

const nameSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.object({ name: nameSchema, digest: digestSchema, previous: digestSchema.optional(), source: z.enum(['builtin', 'local']), enabledProjects: z.array(z.string().uuid()).max(200) });
type RecordEntry = z.infer<typeof recordSchema>;
type Files = Map<string, Buffer>;
const MAX_BYTES = 5 * 1024 * 1024, MAX_FILES = 100;
const hashFiles = (files: Files) => {
  const hash = createHash('sha256');
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  return hash.digest('hex');
};
function metadata(files: Files, name: string) {
  const markdown = files.get('SKILL.md')?.toString('utf8');
  if (!markdown || markdown.length > 64_000) throw new Error('SKILL.md is missing or exceeds 64 KB');
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!header || header[1]!.length > 12_000) throw new Error('Invalid skill frontmatter');
  const parsed = z.object({ name: nameSchema, description: z.string().trim().min(1).max(1024),
    compatibility: z.string().max(500).optional(), metadata: z.record(z.string(), z.string()).optional() }).parse(load(header[1]!, { schema: FAILSAFE_SCHEMA }));
  if (parsed.name !== name) throw new Error('Skill name must match its folder');
  return { title: (parsed.metadata?.title || name).slice(0, 160), description: parsed.description,
    version: (parsed.metadata?.version || 'unversioned').slice(0, 80), compatibility: parsed.compatibility || '', markdown };
}

/** Immutable content-addressed files; the catalog alone owns selection and project enablement. */
export class SkillLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  private previews = new Map<string, { files: Files; name: string; expected?: string; expires: number }>();
  constructor(private root: string) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run); this.queue = next.catch(() => undefined); return next;
  }
  private async catalog(): Promise<RecordEntry[]> {
    try {
      const rows = z.array(recordSchema).max(64).parse(JSON.parse(await fs.readFile(path.join(this.root, 'library.json'), 'utf8')));
      if (new Set(rows.map(row => row.name)).size !== rows.length) throw new Error('Duplicate skill names');
      return rows;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  private async save(rows: RecordEntry[]) {
    await fs.mkdir(this.root, { recursive: true });
    const file = path.join(this.root, `catalog-${randomUUID()}.tmp`);
    await fs.writeFile(file, JSON.stringify(rows));
    try { await fs.rename(file, path.join(this.root, 'library.json')); }
    finally { await fs.rm(file, { force: true }); }
  }
  private async scan(directory: string): Promise<Files> {
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Skill links are not supported');
    const root = await fs.realpath(directory), files: Files = new Map(); let bytes = 0;
    async function visit(relative: string, depth: number) {
      if (depth > 8) throw new Error('Skill directory is too deep');
      for (const item of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
        if (/[:\x00-\x1f]/.test(item.name)) throw new Error('Invalid skill filename');
        const name = relative ? `${relative}/${item.name}` : item.name;
        const filename = path.join(root, name);
        const actual = await fs.realpath(filename);
        if (item.isSymbolicLink() || !actual.startsWith(root + path.sep)) throw new Error('Skill links are not supported');
        if (item.isDirectory()) { await visit(name, depth + 1); continue; }
        if (!item.isFile()) throw new Error('Unsupported skill file');
        const stat = await fs.stat(filename);
        if (files.size >= MAX_FILES || bytes + stat.size > MAX_BYTES) throw new Error('Skill exceeds 100 files or 5 MB');
        const handle = await fs.open(filename, 'r');
        let buffer: Buffer;
        try {
          buffer = Buffer.alloc(Math.min(MAX_BYTES - bytes + 1, stat.size + 1));
          const result = await handle.read(buffer, 0, buffer.length, 0); buffer = buffer.subarray(0, result.bytesRead);
        } finally { await handle.close(); }
        if (buffer.length !== stat.size || bytes + buffer.length > MAX_BYTES) throw new Error('Skill changed during import');
        files.set(name, buffer); bytes += buffer.length;
      }
    }
    await visit('', 0); return files;
  }
  private async materialize(files: Files): Promise<string> {
    const digest = hashFiles(files), target = path.join(this.root, 'objects', digest);
    try { const old = await this.scan(target); if (hashFiles(old) !== digest) throw new Error('Stored skill integrity failed'); return digest; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const stage = path.join(this.root, 'objects', `import-${randomUUID()}`);
    await fs.mkdir(stage, { recursive: true });
    try {
      for (const [name, bytes] of files) { const file = path.join(stage, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes, { flag: 'wx' }); }
      await fs.rename(stage, target);
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
    return digest;
  }
  private async initialize() {
    let rows = await this.catalog();
    for (const [name, markdown] of Object.entries(builtinSkills)) {
      const files = new Map([['SKILL.md', Buffer.from(markdown)]]), old = rows.find(row => row.name === name);
      if (old?.digest === hashFiles(files)) continue;
      if (old && old.source !== 'builtin') throw new Error('Bundled skill ownership conflict');
      const digest = await this.materialize(files);
      rows = [...rows.filter(row => row.name !== name), { name, digest, source: 'builtin', enabledProjects: old?.enabledProjects ?? [], previous: old?.digest }];
      await this.save(rows);
    }
    return rows;
  }
  private async info(row: RecordEntry): Promise<SkillInfo> {
    const files = await this.scan(path.join(this.root, 'objects', row.digest));
    if (hashFiles(files) !== row.digest) throw new Error('Stored skill integrity failed');
    const { markdown: _, ...meta } = metadata(files, row.name);
    return { ...row, ...meta, files: [...files.keys()] };
  }
  list(): Promise<SkillInfo[]> { return this.serial(async () => Promise.all((await this.initialize()).map(row => this.info(row)))); }
  preview(directory: string): Promise<SkillImportPreview> {
    return this.serial(async () => {
      const now = Date.now(); for (const [token, row] of this.previews) if (row.expires < now) this.previews.delete(token);
      if (this.previews.size >= 4) throw new Error('Close earlier import previews first');
      const rows = await this.initialize(), name = nameSchema.parse(path.basename(directory));
      if (Object.hasOwn(builtinSkills, name)) throw new Error('Bundled skills cannot be replaced by an import');
      if (rows.length >= 64 && !rows.some(row => row.name === name)) throw new Error('At most 64 skills may be imported');
      const files = await this.scan(directory), { markdown: _, ...meta } = metadata(files, name);
      const old = rows.find(row => row.name === name), token = randomUUID(), digest = hashFiles(files);
      this.previews.set(token, { files, name, expected: old?.digest, expires: now + 600_000 });
      return { token, replaces: old?.digest, skill: { name, digest, source: 'local', enabledProjects: old?.enabledProjects ?? [], files: [...files.keys()], ...meta } };
    });
  }
  commit(token: string): Promise<void> {
    return this.serial(async () => {
      const preview = this.previews.get(token);
      if (!preview || preview.expires < Date.now()) throw new Error('Import preview expired; select the folder again');
      const rows = await this.initialize(), old = rows.find(row => row.name === preview.name);
      if (old?.digest !== preview.expected) throw new Error('Skill changed; review the import again');
      const digest = await this.materialize(preview.files);
      const row: RecordEntry = { name: preview.name, digest, source: 'local', enabledProjects: old?.enabledProjects ?? [], previous: digest === old?.digest ? old.previous : old?.digest };
      await this.save([...rows.filter(item => item.name !== row.name), row]); this.previews.delete(token);
    });
  }
  discard(token: string): Promise<void> { return this.serial(async () => { this.previews.delete(token); }); }
  enable(name: string, projectId: string, enabled: boolean): Promise<void> {
    return this.serial(async () => {
      z.string().uuid().parse(projectId); z.boolean().parse(enabled);
      const rows = await this.initialize(), row = rows.find(item => item.name === name);
      if (!row) throw new Error('Skill not found');
      await this.save(rows.map(item => item !== row ? item : { ...row, enabledProjects: enabled ? [...new Set([...row.enabledProjects, projectId])] : row.enabledProjects.filter(id => id !== projectId) }));
    });
  }
  rollback(name: string): Promise<void> {
    return this.serial(async () => {
      const rows = await this.initialize(), row = rows.find(item => item.name === name);
      if (!row?.previous || row.source !== 'local') throw new Error('No previous skill version');
      await this.info({ ...row, digest: row.previous });
      await this.save(rows.map(item => item !== row ? item : { ...row, digest: row.previous!, previous: row.digest }));
    });
  }
  details(name: string): Promise<{ skill: SkillInfo; markdown: string }> {
    return this.serial(async () => {
      const row = (await this.initialize()).find(item => item.name === name);
      if (!row) throw new Error('Skill not found');
      const files = await this.scan(path.join(this.root, 'objects', row.digest));
      if (hashFiles(files) !== row.digest) throw new Error('Stored skill integrity failed');
      const { markdown, ...meta } = metadata(files, row.name);
      return { skill: { ...row, ...meta, files: [...files.keys()] }, markdown };
    });
  }
  read(projectId: string, name: string, digest: string, file: string): Promise<string> {
    return this.serial(async () => {
      nameSchema.parse(name); digestSchema.parse(digest);
      if (!file || file.includes('\\') || file.split('/').some(part => !part || part === '..' || part === '.') || /[:\x00-\x1f]/.test(file)) throw new Error('Invalid skill resource');
      const row = (await this.initialize()).find(item => item.name === name);
      if (!row?.enabledProjects.includes(projectId)) throw new Error('Skill is not enabled for this project');
      const files = await this.scan(path.join(this.root, 'objects', digest));
      if (hashFiles(files) !== digest) throw new Error('Stored skill integrity failed');
      metadata(files, name);
      const bytes = files.get(file);
      if (!bytes || bytes.length > 64_000 || bytes.includes(0)) throw new Error('Skill resource is missing, binary or exceeds 64 KB');
      return bytes.toString('utf8');
    });
  }
}
