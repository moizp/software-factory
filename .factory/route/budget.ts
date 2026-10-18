import { Budget, DEFAULT_BUDGET } from './types';

/**
 * Budget with the repository variables applied. Buddy stays off unless BUDDY_ENABLED is exactly "true";
 * BUDDY_RUNNER_GB is the memory of the Buddy runner (GB-minutes are minutes times this).
 */
export function budgetFromEnv(env: Record<string, string | undefined>): Budget {
  const gb = Number(env.BUDDY_RUNNER_GB);
  return {
    ...DEFAULT_BUDGET,
    buddyEnabled: env.BUDDY_ENABLED === 'true',
    buddyRunnerGb: Number.isFinite(gb) && gb > 0 ? gb : DEFAULT_BUDGET.buddyRunnerGb
  };
}
