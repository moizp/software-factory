import { envChecks } from './checks/env';
import { evidenceChecks } from './checks/evidence';
import { githubChecks } from './checks/github';
import { liveChecks } from './checks/live';
import { mockChecks } from './checks/mock';
import { offlineChecks } from './checks/offline';
import { Check, Ctx, Row, Tier, fail } from './types';

export const ALL_CHECKS: Check[] = [...envChecks, ...offlineChecks, ...evidenceChecks, ...mockChecks, ...liveChecks, ...githubChecks];
export const TIERS: Tier[] = ['env', 'offline', 'mock', 'live', 'github'];

/** Which tiers a run includes. `github` is opt-in; `live` always shows one row saying how to ask for it. */
export function tiersFor(ctx: Ctx): Tier[] {
  return TIERS.filter(t => t !== 'github' || ctx.flags.github);
}

/** Runs the checks one after another; a check that throws is a failed row, never a crashed run. */
export async function runChecks(ctx: Ctx, checks: Check[], onRow: (row: Row) => void = () => {}): Promise<Row[]> {
  const rows: Row[] = [];
  for (const c of checks) {
    const started = Date.now();
    let result;
    try {
      result = await c.run(ctx);
    } catch (e) {
      result = fail(`threw: ${(e as Error).message}`, (e as Error).stack?.split('\n').slice(0, 8).join('\n'));
    }
    const row: Row = { id: c.id, tier: c.tier, title: c.title, ms: Date.now() - started, ...result };
    rows.push(row);
    onRow(row);
  }
  return rows;
}
