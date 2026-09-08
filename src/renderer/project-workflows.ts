import { translate } from './i18n.js';

export type Workflow = 'implement' | 'diagnose' | 'review';
const templates: Record<Workflow, string> = {
  implement: "Implement the requested change in this project. Read project instructions and identify existing build and test commands. Preserve unrelated changes. Make a focused change, run relevant checks, and report changed files, validation evidence and remaining limitations.",
  diagnose: "Investigate this project problem. Reproduce it and record the exact error and environment. Identify the root cause before editing. Make a focused fix, rerun the original reproduction and nearby checks, and distinguish confirmed results from hypotheses.",
  review: "Review current project changes without editing files. Inspect the diff, identify correctness and compatibility risks, and cite exact files and lines. Report available test evidence and missing coverage. Never claim a test passed unless it was actually run."
};

/** Preparing a workflow only changes the draft; the user still reviews and sends it. */
export function workflowDraft(current: string, kind: Workflow): string {
  const instructions = translate(templates[kind]);
  return current.trim() ? `${current}\n\n${instructions}` : instructions;
}
