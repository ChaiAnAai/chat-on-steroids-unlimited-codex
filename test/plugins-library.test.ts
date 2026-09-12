import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ data: undefined as unknown, fail: false }));
vi.mock('../src/main/durable.js', () => ({
  readDurable: vi.fn(async () => structuredClone(storage.data)),
  writeDurableNow: vi.fn(async (_key: string, value: unknown) => {
    if (storage.fail) throw new Error('Disk full');
    storage.data = structuredClone(value);
  })
}));
import { manageMcpLibrary } from '../src/main/plugins/library.js';
beforeEach(() => { storage.data = undefined; storage.fail = false; });
it('serializes collection changes and retains durable favorites after a rejected write', async () => {
  await Promise.all(['org/a', 'org/b'].map(name => manageMcpLibrary({ action: 'favorite', name, enabled: true })));
  expect((await manageMcpLibrary({ action: 'list' })).favorites).toEqual(['org/a', 'org/b']);
  storage.fail = true;
  await expect(manageMcpLibrary({ action: 'favorite', name: 'org/a', enabled: false })).rejects.toThrow('Disk full');
  storage.fail = false;
  expect((await manageMcpLibrary({ action: 'list' })).favorites).toContain('org/a');
});
it('bounds and deduplicates recently viewed entries without changing favorites', async () => {
  for (let index = 0; index < 35; index++) await manageMcpLibrary({ action: 'view', name: `org/${index}` });
  const result = await manageMcpLibrary({ action: 'view', name: 'org/10' });
  expect(result.recent).toHaveLength(30); expect(result.recent[0]!.name).toBe('org/10');
  expect(new Set(result.recent.map(row => row.name)).size).toBe(30); expect(result.favorites).toEqual([]);
});
