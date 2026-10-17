import { RunnerUsage } from './types';

export function emptyUsage(): RunnerUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
}

export function addUsage(a: RunnerUsage, b: RunnerUsage): RunnerUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    costUsd: a.costUsd + b.costUsd
  };
}

/** Cap on reviews per UTC day; protects personal account allowances. 0 or NaN means no cap. */
export function dailyCapReached(reviewsToday: number, cap: number): boolean {
  return Number.isFinite(cap) && cap > 0 && reviewsToday >= cap;
}

/** Budget guard for the API-key fallback only. Account runs are not metered in dollars. */
export function monthlyBudgetReached(spentUsd: number, budgetUsd: number): boolean {
  return Number.isFinite(budgetUsd) && budgetUsd > 0 && spentUsd >= budgetUsd;
}

/** One line per review for the step summary and the ledger artifact. */
export function ledgerLine(entry: {
  pr: number; head_sha: string; attempt: number; tier: string; runner: string; usage: RunnerUsage;
}): string {
  return JSON.stringify({ ts: new Date().toISOString(), ...entry });
}
