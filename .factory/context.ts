import { estimateTokens } from './prompts';

/**
 * The context pack: everything an agent gets to see, built on purpose. Agents run without tools, so this JSON is the
 * whole input. Keys come in a fixed order, stable parts first (the same keys land in the same place in every agent's
 * prompt, so a repeated or re-asked call shares the longest possible prefix), values the agent is not allowed to lose
 * stay intact, and anything over the agent's cap is shortened in steps, with a record of what was cut.
 * Everything here is pure.
 */

/** Stable, widely shared parts first; parts that change between calls last. */
export const CONTEXT_ORDER = [
  'brief', 'mission', 'productManagerOutput', 'analyzerOutput', 'architectOutput', 'builderOutputs', 'testerOutput',
  'allArtifacts', 'planCheck', 'humanAnswers'
];

/** Never shortened: the task itself, the mission, what a person decided, and the plan check. If these alone are too big the pack says so. */
const PROTECTED = new Set(['brief', 'mission', 'humanAnswers', 'planCheck']);

interface Limits {
  /** Longest string kept, in characters. */
  str: number;
  /** Most array items kept. */
  arr: number;
}

/** Tried in order until the pack fits. Each step cuts harder than the one before. */
const STEPS: Limits[] = [
  { str: 2000, arr: 50 },
  { str: 800, arr: 25 },
  { str: 300, arr: 12 },
  { str: 120, arr: 6 }
];

const MAX_DEPTH = 24;

export function shrinkValue(value: unknown, limits: Limits, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[too deep]';
  if (typeof value === 'string') {
    return value.length > limits.str ? `${value.slice(0, limits.str)}... [${value.length - limits.str} characters cut]` : value;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, limits.arr).map(v => shrinkValue(v, limits, depth + 1));
    return value.length > limits.arr ? [...kept, `[${value.length - limits.arr} more items cut]`] : kept;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shrinkValue(v, limits, depth + 1)]));
  }
  return value;
}

export interface PackMeta {
  estimatedTokens: number;
  budgetTokens: number | null;
  trimmed: Array<{ key: string; beforeTokens: number; afterTokens: number }>;
  /** Still over the cap after the hardest step: the protected parts alone, or what could not be shortened, are too big. */
  overBudget: boolean;
}

export interface Pack {
  context: Record<string, unknown>;
  meta: PackMeta;
}

const tokensOf = (value: unknown): number => estimateTokens(JSON.stringify(value) ?? '');

export function orderKeys(input: Record<string, unknown>): Record<string, unknown> {
  const known = CONTEXT_ORDER.filter(k => k in input);
  const rest = Object.keys(input).filter(k => !CONTEXT_ORDER.includes(k)).sort();
  return Object.fromEntries([...known, ...rest].map(k => [k, input[k]]));
}

/**
 * Orders the input and, when it is over `budgetTokens`, shortens the values that may be shortened, harder at each step,
 * until it fits. Without a budget the input is only ordered.
 */
export function packContext(input: Record<string, unknown>, budgetTokens: number | null): Pack {
  const ordered = orderKeys(input);
  const before = tokensOf(ordered);
  if (budgetTokens === null || before <= budgetTokens) {
    return { context: ordered, meta: { estimatedTokens: before, budgetTokens, trimmed: [], overBudget: false } };
  }

  let context = ordered;
  for (const step of STEPS) {
    context = Object.fromEntries(Object.entries(ordered).map(([k, v]) => [k, PROTECTED.has(k) ? v : shrinkValue(v, step)]));
    if (tokensOf(context) <= budgetTokens) break;
  }

  const trimmed = Object.keys(ordered)
    .map(key => ({ key, beforeTokens: tokensOf(ordered[key]), afterTokens: tokensOf(context[key]) }))
    .filter(t => t.afterTokens < t.beforeTokens);
  const after = tokensOf(context);
  return { context, meta: { estimatedTokens: after, budgetTokens, trimmed, overBudget: after > budgetTokens } };
}

export function describePack(agent: string, meta: PackMeta): string | null {
  if (meta.trimmed.length === 0 && !meta.overBudget) return null;
  const cuts = meta.trimmed.map(t => `${t.key} ${t.beforeTokens} to ${t.afterTokens}`).join(', ');
  return `Input for ${agent} was shortened to fit its ${meta.budgetTokens} token cap${cuts ? ` (${cuts})` : ''}${meta.overBudget ? `; still ${meta.estimatedTokens} tokens, over the cap` : ''}`;
}

/**
 * Artifacts as an agent should see them: the newest of each phase and type, without timestamps. A phase that ran twice
 * (a re-ask, a retry) would otherwise appear twice.
 */
export function compactArtifacts(artifacts: Array<{ phase: string; type: string; content?: Record<string, unknown> }>): Array<{ phase: string; type: string; content?: Record<string, unknown> }> {
  const latest = new Map<string, { phase: string; type: string; content?: Record<string, unknown> }>();
  for (const a of artifacts) {
    const key = `${a.phase}\u0000${a.type}`;
    latest.delete(key);
    latest.set(key, { phase: a.phase, type: a.type, ...(a.content !== undefined ? { content: a.content } : {}) });
  }
  return [...latest.values()];
}
