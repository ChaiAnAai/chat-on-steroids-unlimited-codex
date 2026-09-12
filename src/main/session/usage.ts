import { z } from 'zod';
import { listUsageSessions, readEvents } from './store.js';
import { readDurable, writeDurableSoon, writeDurableNow } from '../durable.js';
import type { Account, TrustedAccountPrincipal, AccountManagementSnapshot } from '../../shared/accounts.js';
import { logInfo } from '../logger.js';
import { eventTokens } from '../../shared/session.js';
import { usageModelKey, type ModelUsage, type UsageModelTokens, type UsageOverview } from '../../shared/usage.js';
const row = z.object({ model: z.string().min(1).max(100), scope: z.enum(['model', 'feature', 'shared']), remaining: z.number().finite().nonnegative().nullable(), remainingPercent: z.number().min(0).max(100).nullable(), resetAt: z.number().finite().positive().nullable(), windowSeconds: z.number().finite().positive().nullable() });
let limits: ModelUsage[] = [];
let latestObservedAt = 0;
const accountLimits = new Map<string, { version: number; observedAt: number; rows: ModelUsage[] }>();
const FRESH_MS = 10 * 60000;
const accountQuotaSchema = z.object({ accountId: z.string().uuid(), version: z.number().int().positive(), observedAt: z.number().finite().nonnegative(), rows: z.array(row.extend({ observedAt: z.number().finite().nonnegative() })).max(80) });
let quotaWrite: Promise<unknown> = Promise.resolve();
const quotaFile = (id: string) => `quota-${z.string().uuid().parse(id).replaceAll('-', '')}`;
/** Persist observations, never authorization. Restored history is not loaded into the live allowance map. */
export function observeAccountUsage(raw: unknown, capturedAt: unknown, principal: TrustedAccountPrincipal): Promise<void> {
  const run = quotaWrite.then(async () => {
    const { assertAccountConnection } = await import('../accounts.js');
    await assertAccountConnection(principal);
    const parsed = z.array(row).max(80).parse(raw);
    const now = Date.now();
    if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt > now + 5000 || now - capturedAt > FRESH_MS) return;
    const saved = accountQuotaSchema.safeParse(await readDurable(quotaFile(principal.accountId)));
    if (saved.success && (saved.data.version > principal.connectionVersion || (saved.data.version === principal.connectionVersion && saved.data.observedAt > capturedAt))) return;
    await assertAccountConnection(principal);
    const snapshot = { accountId: principal.accountId, version: principal.connectionVersion, observedAt: capturedAt, rows: parsed.map(entry => ({ ...entry, observedAt: capturedAt })) };
    await writeDurableNow(quotaFile(principal.accountId), snapshot);
    await assertAccountConnection(principal);
    observeUsage(parsed, capturedAt, principal);
  });
  quotaWrite = run.catch(() => undefined);
  return run;
}
export async function accountQuotaView(account: Account): Promise<NonNullable<AccountManagementSnapshot['quotas']>[string]> {
  const saved = accountQuotaSchema.safeParse(await readDurable(quotaFile(account.id)));
  if (!saved.success || saved.data.accountId !== account.id) return { state: 'unknown', observedAt: null, rows: [] };
  const fresh = account.connected && !!account.identity && account.connectionVersion === saved.data.version && saved.data.observedAt <= Date.now() + 5000 && Date.now() - saved.data.observedAt <= FRESH_MS;
  const rows = fresh ? saved.data.rows.filter(entry => entry.resetAt === null || entry.resetAt > Date.now()) : [];
  return { state: rows.length ? 'fresh' : 'stale', observedAt: saved.data.observedAt, rows };
}
/** Fresh provider quota only; local token estimates never authorize automation. */
export function automationQuota(model?: string, reservePercent = 10, accountId?: string, connectionVersion?: number): string | null {
  const now = Date.now();
  const snapshot = accountId ? accountLimits.get(accountId) : undefined;
  const source = accountId ? snapshot && connectionVersion !== undefined && snapshot.version === connectionVersion ? snapshot.rows : [] : limits;
  const relevant = source.filter(row => (row.scope === 'shared' || row.model === model) && now - row.observedAt <= FRESH_MS && (row.resetAt === null || row.resetAt > now));
  if (!relevant.length || relevant.some(row => row.remainingPercent === null)) return 'quota-unknown';
  return relevant.some(row => row.remainingPercent! <= reservePercent) ? 'quota-reserve' : null;
}
export function observeUsage(raw: unknown, capturedAt: unknown = Date.now(), account?: { accountId: string; connectionVersion: number }): void {
  const parsed = z.array(row).max(80).parse(raw);
  const now = Date.now();
  const previous = account ? accountLimits.get(account.accountId)?.observedAt ?? 0 : latestObservedAt;
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt > now + 5000 || now - capturedAt > FRESH_MS || capturedAt < previous) return;
  if (account) {
    if (accountLimits.has(account.accountId) && accountLimits.get(account.accountId)!.version > account.connectionVersion) return;
    accountLimits.set(account.accountId, { version: account.connectionVersion, observedAt: capturedAt, rows: parsed.map(entry => ({ ...entry, observedAt: capturedAt })) });
    return;
  }
  // A snapshot is one account observation. Never merge old counters from another
  // account/tab into the latest response; an explicit empty snapshot clears them.
  latestObservedAt = capturedAt;
  limits = parsed.map((entry) => ({ ...entry, observedAt: capturedAt }));
}
export async function accountAutomationQuota(model?: string, reservePercent = 10, accountId?: string): Promise<string | null> {
  if (!accountId) return automationQuota(model, reservePercent);
  const account = await (await import('../accounts.js')).getAccount(accountId);
  if (!account?.connected || account.paused || !account.identity) return 'quota-unknown';
  return automationQuota(model, reservePercent, accountId, account.connectionVersion);
}
// One persisted derived cache owns both daily and model totals. Formula edits project
// this baseline; only changed canonical session revisions reread transcripts.
const CACHE_VERSION = 4;
const modelTokens = z.object({ model: z.string().min(1).max(100), reasoningEffort: z.string().max(100).nullable(), assumed: z.boolean(), tokens: z.number().finite().nonnegative() });
const cacheRow = z.object({ id: z.string().max(64), revision: z.string().max(200), days: z.array(z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.array(modelTokens)])).max(36600) });
const cacheSchema = z.object({ version: z.literal(CACHE_VERSION), rows: z.array(cacheRow).max(100000) });
const dayCache = new Map<string, { revision: string; days: Map<string, UsageModelTokens[]> }>();
let cacheLoaded = false;
let overviewFlight: Promise<UsageOverview> | null = null;
export function usageOverview(): Promise<UsageOverview> {
  return overviewFlight ??= computeOverview().finally(() => { overviewFlight = null; });
}
function mergeModels(target: Map<string, UsageModelTokens>, rows: readonly UsageModelTokens[]): void {
  for (const row of rows) {
    const key = usageModelKey(row);
    const previous = target.get(key);
    target.set(key, { ...row, tokens: (previous?.tokens ?? 0) + row.tokens });
  }
}
type Attribution = Pick<UsageModelTokens, 'model' | 'reasoningEffort' | 'assumed'>;
const LEGACY: Attribution = { model: 'gpt-5.6', reasoningEffort: 'high', assumed: true };
function attribution(raw: { model?: string; reasoningEffort?: string }, previous: Attribution): Attribution {
  const model = raw.model?.trim();
  const effort = raw.reasoningEffort?.trim();
  if (model) return { model, reasoningEffort: effort || (!previous.assumed && model === previous.model ? previous.reasoningEffort : null), assumed: false };
  if (effort) return { ...previous, reasoningEffort: effort };
  return previous;
}
async function computeOverview(): Promise<UsageOverview> {
  const started = performance.now();
  let rebuilt = 0;
  if (!cacheLoaded) {
    const saved = cacheSchema.safeParse(await readDurable('usage-cache'));
    if (saved.success) for (const row of saved.data.rows) dayCache.set(row.id, { revision: row.revision, days: new Map(row.days) });
    cacheLoaded = true;
  }
  const sessions = await listUsageSessions();
  let dirty = false;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = new Map<string, Map<string, UsageModelTokens>>();
  const models = new Map<string, UsageModelTokens>();
  for (const session of sessions) {
    const revision = `${timezone}:${session.updatedAt}:${session.events}:${session.estimatedTokens}`;
    let cached = dayCache.get(session.id);
    if (cached?.revision !== revision) {
      rebuilt++;
      const perDay = new Map<string, Map<string, UsageModelTokens>>();
      let context = 0;
      let conversation: string | null = null;
      let selected = LEGACY;
      const calls: Array<{ day: string; attribution: Attribution }> = [];
      const countedCalls = new Set<string>();
      const finishSegment = () => {
        // User-selected estimate: final frontend context / 2 per unique local
        // call. Model switches divide attribution, never the frontend context.
        for (const call of calls) {
          const totals = perDay.get(call.day) ?? new Map<string, UsageModelTokens>();
          mergeModels(totals, [{ ...call.attribution, tokens: context / 2 }]);
          perDay.set(call.day, totals);
        }
        calls.length = 0; context = 0; selected = LEGACY;
      };
      for (const event of await readEvents(session.id)) {
        if (event.kind === 'session_start') { finishSegment(); conversation = event.conversationId; }
        if (event.kind === 'tool_call') {
          if (countedCalls.has(event.call.callId)) continue;
          countedCalls.add(event.call.callId);
          if (!event.call.conversationId || (conversation && conversation !== event.call.conversationId)) finishSegment();
          conversation = event.call.conversationId;
        }
        // Recorded selection belongs to this frontend history, never a mutable
        // global picker or a worker's requested-but-unconfirmed spawn setting.
        if (event.kind === 'user_message' && !event.messageId?.startsWith('input:')) selected = LEGACY;
        if (event.kind !== 'user_message' || !event.messageId?.startsWith('input:')) selected = attribution(event, selected);
        context += eventTokens(event);
        if (event.kind !== 'tool_call') continue;
        const date = new Date(event.time);
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        calls.push({ day, attribution: attribution(event.call, selected) });
        if (!conversation) finishSegment();
      }
      finishSegment();
      dirty = true;
      cached = { revision, days: new Map([...perDay].map(([day, values]) => [day, [...values.values()]])) }; dayCache.set(session.id, cached);
    }
    for (const [date, rows] of cached.days) {
      const totals = days.get(date) ?? new Map<string, UsageModelTokens>();
      mergeModels(totals, rows); days.set(date, totals); mergeModels(models, rows);
    }
  }
  const ids = new Set(sessions.map((session) => session.id));
  for (const id of dayCache.keys()) if (!ids.has(id)) { dayCache.delete(id); dirty = true; }
  if (dirty) writeDurableSoon('usage-cache', { version: CACHE_VERSION, rows: [...dayCache].map(([id, row]) => ({ id, revision: row.revision, days: [...row.days] })) });
  logInfo(`usage overview sessions=${sessions.length} reused=${sessions.length - rebuilt} rebuilt=${rebuilt} elapsed_ms=${Math.round(performance.now() - started)}`);
  return {
    limits: limits.filter((entry) => Date.now() - entry.observedAt <= FRESH_MS && (entry.resetAt === null || entry.resetAt > Date.now())).map((entry) => ({ ...entry })),
    days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, tokens: [...rows.values()].reduce((sum, row) => sum + row.tokens, 0), models: [...rows.values()] })),
    models: [...models.values()], tokens: [...models.values()].reduce((sum, row) => sum + row.tokens, 0), sessions: sessions.length
  };
}
