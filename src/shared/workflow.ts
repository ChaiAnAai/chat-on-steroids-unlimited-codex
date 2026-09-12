import { z } from 'zod';

export const checkpointSchema = z.object({
  revision: z.number().int().nonnegative(),
  outcome: z.enum(['continue', 'completed', 'blocked']),
  summary: z.string().trim().min(1).max(2000),
  next: z.string().trim().max(4000).optional(),
  evidence: z.array(z.string().trim().min(1).max(500)).max(12).default([])
}).strict().refine(value => value.outcome !== 'continue' || !!value.next, 'A continuation needs a concrete next step');
export type Checkpoint = z.infer<typeof checkpointSchema>;
export interface SessionWorkflow {
  revision: number;
  intent: 'plan' | 'execute';
  objective: string;
  mode: 'off' | 'goal' | 'loop';
  used: number;
  segment: number;
  noProgress: number;
  evidence: string[];
  completedSteps: string[];
  lastInputId?: string;
  pause?: string;
  checkpoint?: Checkpoint & { turnId: string; conversationId: string; at: number };
  pending?: { id: string; turnId: string; revision: number };
}
export const WORKFLOW_LIMIT = 10;
export function newWorkflow(): SessionWorkflow {
  return { revision: 0, intent: 'execute', objective: '', mode: 'off', used: 0, segment: 0, noProgress: 0, evidence: [], completedSteps: [] };
}
export function sameSessionPolicy(config: { goal: { executionPolicy?: string } }): boolean {
  return config.goal.executionPolicy !== 'legacy-helper';
}
export type FailureKind = 'access-restricted' | 'quota' | 'timeout' | 'cancelled' | 'delivery-unknown' | 'network' | 'tool';
export function classifyFailure(text: string): FailureKind {
  if (/unusual activity|suspicious activity|verification required|verify.*human|account.*restrict|temporarily (?:restrict|limited).*access|异常活动|可疑活动|验证.*身份|访问受限|账号.*限制|限制.*访问对话记录/i.test(text)) return 'access-restricted';
  if (/rate.?limit|too many requests|quota|usage limit|额度|用量.*上限|请求过多/i.test(text)) return 'quota';
  if (/unconfirmed|unknown delivery|送达.*(不明|未确认)/i.test(text)) return 'delivery-unknown';
  if (/timeout_or_cancelled/i.test(text)) return 'delivery-unknown';
  if (/timed? ?out|timeout|超时/i.test(text)) return 'timeout';
  if (/cancel|abort|取消/i.test(text)) return 'cancelled';
  if (/network|fetch|connection|网络|连接/i.test(text)) return 'network';
  return 'tool';
}
