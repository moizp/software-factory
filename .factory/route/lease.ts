import { Lane } from './types';

/**
 * A running job keeps one comment on its issue, edited about every 10 minutes:
 *   <!-- agent-lease job=<id> lane=<lane> beat=<ISO time> restarts=<n> -->
 * The comment is the lease. If the beat goes stale the job is presumed dead.
 */
export interface Lease {
  job: string;
  lane: Lane;
  beat: Date;
  restarts: number;
}

export const STALE_AFTER_MINUTES = 30;
export const MAX_RESTARTS = 1;

const PATTERN = /<!--\s*agent-lease\s+job=(\S+)\s+lane=(short|long|burst)\s+beat=(\S+)\s+restarts=(\d+)\s*-->/;

export function renderLease(lease: Lease): string {
  return `<!-- agent-lease job=${lease.job} lane=${lease.lane} beat=${lease.beat.toISOString()} restarts=${lease.restarts} -->`;
}

/** Returns null for anything that is not a well-formed lease, including an unparseable time. */
export function parseLease(body: string): Lease | null {
  const m = PATTERN.exec(body);
  if (!m) return null;
  const beat = new Date(m[3]);
  if (Number.isNaN(beat.getTime())) return null;
  return { job: m[1], lane: m[2] as Lane, beat, restarts: parseInt(m[4], 10) };
}

export function isStale(lease: Lease, now: Date, staleAfterMinutes: number = STALE_AFTER_MINUTES): boolean {
  return now.getTime() - lease.beat.getTime() > staleAfterMinutes * 60_000;
}

export function heartbeat(lease: Lease, now: Date): Lease {
  return { ...lease, beat: now };
}

export interface SweepItem {
  issue: number;
  /** Null when the issue is working but has no readable lease comment. */
  lease: Lease | null;
}

export type SweepAction =
  | { issue: number; action: 'requeue'; restarts: number; reason: string }
  | { issue: number; action: 'escalate'; reason: string };

/**
 * Decides what to do with issues labelled agent:working. A live lease is left alone. A dead one goes
 * back to ready once; the second time it goes to a human. A missing lease goes to a human.
 */
export function sweep(items: SweepItem[], now: Date, staleAfterMinutes: number = STALE_AFTER_MINUTES): SweepAction[] {
  const out: SweepAction[] = [];
  for (const { issue, lease } of items) {
    if (!lease) {
      // Without a readable lease there is no restart count to trust, so a human looks at it.
      out.push({ issue, action: 'escalate', reason: 'no readable lease comment' });
      continue;
    }
    if (!isStale(lease, now, staleAfterMinutes)) continue;
    const why = `no heartbeat since ${lease.beat.toISOString()}`;
    if (lease.restarts >= MAX_RESTARTS) out.push({ issue, action: 'escalate', reason: `${why}; already restarted ${lease.restarts} time(s)` });
    else out.push({ issue, action: 'requeue', restarts: lease.restarts + 1, reason: why });
  }
  return out;
}
