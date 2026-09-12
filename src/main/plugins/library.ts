import { z } from 'zod';
import { readDurable, writeDurableNow } from '../durable.js';

const name = z.string().trim().min(1).max(256);
const schema = z.object({ favorites: z.array(name).max(200), recent: z.array(z.object({ name, at: z.number().finite() })).max(30) });
export type McpLibrary = z.infer<typeof schema>;
const request = z.discriminatedUnion('action', [z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('favorite'), name, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('view'), name }).strict()]);
let queue: Promise<unknown> = Promise.resolve();
export function manageMcpLibrary(payload: unknown): Promise<McpLibrary> {
  const input = request.parse(payload);
  const work = queue.then(async () => {
    const previous = schema.parse(await readDurable('mcp-library') ?? { favorites: [], recent: [] });
    if (input.action === 'list') return previous;
    const next = input.action === 'favorite' ? { ...previous, favorites: input.enabled ? [...new Set([...previous.favorites, input.name])] : previous.favorites.filter(name => name !== input.name) }
      : { ...previous, recent: [{ name: input.name, at: Date.now() }, ...previous.recent.filter(row => row.name !== input.name)].slice(0, 30) };
    const result = schema.parse(next); await writeDurableNow('mcp-library', result); return result;
  });
  queue = work.catch(() => undefined); return work;
}
