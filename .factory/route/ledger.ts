import { Budget, Charge, Ledger } from './types';

const MARKER = /<!--\s*agent-ledger\s+(\{[^}]*\})\s*-->/;

export function monthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function emptyLedger(now: Date): Ledger {
  return { month: monthOf(now), actionsMinutes: 0, buddyGbMinutes: 0, oracleSeconds: 0 };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Reads the ledger from the pinned issue body. A missing marker is a fresh ledger; a marker that is
 * present but unreadable returns null so the router fails closed instead of assuming nothing is spent.
 * A ledger from an earlier month starts again at zero.
 */
export function parseLedger(body: string, now: Date): Ledger | null {
  const m = MARKER.exec(body);
  if (!m) return emptyLedger(now);
  let raw: any;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const actions = num(raw.actionsMinutes);
  const buddy = num(raw.buddyGbMinutes);
  const oracle = num(raw.oracleSeconds);
  if (typeof raw.month !== 'string' || actions === null || buddy === null || oracle === null) return null;
  if (raw.month !== monthOf(now)) return emptyLedger(now);
  return { month: raw.month, actionsMinutes: actions, buddyGbMinutes: buddy, oracleSeconds: oracle };
}

export function renderLedger(ledger: Ledger): string {
  return `<!-- agent-ledger ${JSON.stringify(ledger)} -->`;
}

/** Replaces the marker in an issue body, or appends it. */
export function writeLedger(body: string, ledger: Ledger): string {
  const marker = renderLedger(ledger);
  return MARKER.test(body) ? body.replace(MARKER, marker) : `${body.trimEnd()}\n\n${marker}\n`;
}

/**
 * Charges a finished job. Hosted Actions bills each job rounded up to whole minutes (at least one).
 * Buddy bills GB-minutes, so minutes times the runner memory. Oracle is only counted in seconds.
 */
export function recordUsage(ledger: Ledger, charge: Charge, seconds: number, budget: Budget, now: Date): Ledger {
  const base = ledger.month === monthOf(now) ? ledger : emptyLedger(now);
  const secs = Math.max(0, Math.round(seconds));
  const minutes = Math.max(1, Math.ceil(secs / 60));
  switch (charge) {
    case 'short':
    case 'route':
      return { ...base, actionsMinutes: base.actionsMinutes + minutes };
    case 'burst':
      return { ...base, buddyGbMinutes: base.buddyGbMinutes + minutes * budget.buddyRunnerGb };
    case 'long':
      return { ...base, oracleSeconds: base.oracleSeconds + secs };
  }
}

export function actionsRatio(ledger: Ledger | null, budget: Budget): number {
  if (ledger === null) return 1;
  return ledger.actionsMinutes / budget.actionsMonthlyMinutes;
}

export function buddyRatio(ledger: Ledger | null, budget: Budget): number {
  if (ledger === null) return 1;
  return ledger.buddyGbMinutes / budget.buddyMonthlyGbMinutes;
}
