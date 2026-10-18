import { Usage } from './state';

/**
 * Self-correcting retries. When an agent's reply is unusable (not JSON, or it breaks its contract), the orchestrator
 * asks once more with a short statement of what was wrong, instead of ending the stage. A reply where the agent
 * itself says it cannot proceed (valid: false with a reason) is a decision, not a mistake, and is never re-asked.
 */

/** Re-asks per agent call. One means at most two model calls; 0 turns the feature off. */
export const DEFAULT_MAX_REPAIRS = 1;
export const HARD_MAX_REPAIRS = 3;
const MAX_PROBLEM_CHARS = 500;

export type FailureKind = 'none' | 'repairable' | 'declined';

/** Set by the Claude bridge when the model's text could not be turned into a response envelope. */
export type FailureMarker = 'malformed_output';

export interface RepairNote {
  attempt: number;
  problem: string;
}

export function maxRepairs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FACTORY_MAX_REPAIRS;
  if (raw === undefined || raw === '') return DEFAULT_MAX_REPAIRS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_MAX_REPAIRS;
  return Math.min(n, HARD_MAX_REPAIRS);
}

/** Collapses whitespace and cuts long text so a repair prompt stays small however large the bad reply was. */
export function trimProblem(text: string, max: number = MAX_PROBLEM_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

export function classifyFailure(
  response: { valid?: boolean; error?: string; failure?: string } | null | undefined,
  contractProblem: string | null
): { kind: FailureKind; problem: string } {
  if (contractProblem) return { kind: 'repairable', problem: contractProblem };
  if (response && response.failure === 'malformed_output') {
    return { kind: 'repairable', problem: response.error ?? 'The reply could not be read as a JSON object.' };
  }
  if (response && response.valid === false) return { kind: 'declined', problem: response.error ?? '' };
  return { kind: 'none', problem: '' };
}

/** The same input plus a repair note. The prompt builder renders the note and leaves it out of the JSON context. */
export function withRepair<T extends Record<string, unknown>>(input: T, attempt: number, problem: string): T & { repair: RepairNote } {
  return { ...input, repair: { attempt, problem: trimProblem(problem) } };
}

/** Adds measured usage across attempts so a re-ask is paid for in the token budget, not hidden. */
export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
    turns: a.turns + b.turns
  };
}
