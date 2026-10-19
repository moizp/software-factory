import * as fs from 'fs';
import * as path from 'path';
import { AGENT_NAMES, AgentName, agentFilePath } from './pipeline';
import type { WorkflowState } from './state';

/**
 * Owning the context window: how big each agent's prompt is, what it is allowed to grow to, and what the agents actually
 * cost when they run. Token figures for files are estimates (characters / 4); real usage comes from the Claude CLI and is
 * recorded on every phase gate.
 */

export interface AgentBudget {
  /** Cap on the agent's instruction file, in estimated tokens. */
  instructions: number;
  /** Cap on the JSON input handed to the agent, in estimated tokens. See context.ts. */
  context: number;
}

export const BUDGETS_PATH = path.join(__dirname, 'prompt-budgets.json');

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function loadBudgets(file: string = BUDGETS_PATH): Record<string, AgentBudget> {
  return JSON.parse(fs.readFileSync(file, 'utf-8')).agents as Record<string, AgentBudget>;
}

/** The input cap for an agent, or null when none is set. */
export function contextBudget(agent: string, budgets: Record<string, AgentBudget> = loadBudgets()): number | null {
  return budgets[agent]?.context ?? null;
}

export interface PromptRow {
  agent: AgentName;
  lines: number;
  tokens: number;
  /** Size of the sample reply under "Output Format" (the first json block): the usual bulk of a prompt. */
  exampleTokens: number;
  budget: number;
  over: boolean;
}

/** The first ```json block after the "Output Format" heading, or null. */
export function outputExample(markdown: string): string | null {
  const i = markdown.indexOf('## Output Format');
  if (i < 0) return null;
  const m = /```json\n([\s\S]*?)\n```/.exec(markdown.slice(i));
  return m ? m[1] : null;
}

export function measurePrompts(budgets: Record<string, AgentBudget> = loadBudgets(), read: (agent: string) => string = a => fs.readFileSync(agentFilePath(a), 'utf-8')): PromptRow[] {
  return AGENT_NAMES.map(agent => {
    const text = read(agent);
    const tokens = estimateTokens(text);
    const budget = budgets[agent]?.instructions ?? 0;
    return {
      agent,
      lines: text.split('\n').length,
      tokens,
      exampleTokens: estimateTokens(outputExample(text) ?? ''),
      budget,
      over: budget > 0 ? tokens > budget : true
    };
  });
}

export function renderPromptReport(rows: PromptRow[]): string {
  const head = ['Agent', 'Lines', 'Tokens', 'Sample reply', 'Budget', ''];
  const body = rows.map(r => [r.agent, String(r.lines), String(r.tokens), String(r.exampleTokens), String(r.budget), r.over ? 'OVER' : '']);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd();
  const total = rows.reduce((s, r) => s + r.tokens, 0);
  return [
    line(head), line(widths.map(w => '-'.repeat(w))), ...body.map(line), '',
    `Total ${total} tokens across ${rows.length} agents (estimate: characters / 4). A full pipeline run sends each prompt once, plus any re-ask.`
  ].join('\n');
}

export interface UsageRow {
  agent: string;
  calls: number;
  avgTotal: number;
  avgInput: number;
  avgOutput: number;
  /** Share of input tokens served from the prompt cache, 0 to 1. */
  cacheShare: number;
  totalTokens: number;
}

/** Real usage per agent from saved workflow states: every gate that recorded usage counts as one call. */
export function usageByAgent(states: Array<Pick<WorkflowState, 'phases'>>): UsageRow[] {
  const acc = new Map<string, { calls: number; total: number; input: number; output: number; cacheRead: number; cacheCreate: number }>();
  for (const s of states) {
    for (const g of s.phases) {
      if (!g.usage) continue;
      const a = acc.get(g.phase) ?? { calls: 0, total: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      a.calls++;
      a.total += g.usage.totalTokens;
      a.input += g.usage.inputTokens;
      a.output += g.usage.outputTokens;
      a.cacheRead += g.usage.cacheReadTokens;
      a.cacheCreate += g.usage.cacheCreationTokens;
      acc.set(g.phase, a);
    }
  }
  return [...acc.entries()].map(([agent, a]) => {
    const allInput = a.input + a.cacheRead + a.cacheCreate;
    return {
      agent,
      calls: a.calls,
      avgTotal: Math.round(a.total / a.calls),
      avgInput: Math.round(allInput / a.calls),
      avgOutput: Math.round(a.output / a.calls),
      cacheShare: allInput > 0 ? a.cacheRead / allInput : 0,
      totalTokens: a.total
    };
  }).sort((x, y) => y.totalTokens - x.totalTokens);
}

export function renderUsageReport(rows: UsageRow[]): string {
  if (rows.length === 0) return 'No usage recorded yet: run a workflow with the real agents first.';
  const head = ['Agent', 'Calls', 'Avg total', 'Avg input', 'Avg output', 'Cached input', 'All tokens'];
  const body = rows.map(r => [r.agent, String(r.calls), String(r.avgTotal), String(r.avgInput), String(r.avgOutput), `${Math.round(r.cacheShare * 100)}%`, String(r.totalTokens)]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(head), line(widths.map(w => '-'.repeat(w))), ...body.map(line)].join('\n');
}
