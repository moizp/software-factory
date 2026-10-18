import { actionsRatio, buddyRatio } from './ledger';
import { Lease, SweepAction, renderLease } from './lease';
import { renderRequeueMarker } from './ask';
import { Budget, Ledger, Permission } from './types';

/** Workflows started with GITHUB_TOKEN (the sweep re-dispatching a requeued issue) run as this actor. */
export const BOT_ACTOR = 'github-actions[bot]';
export const LANE_LABELS = ['lane:short', 'lane:long', 'lane:burst'];
export const LEDGER_WARNING_MARKER = '<!-- agent-ledger-warning -->';

/**
 * Permission to start work. The bot actor is trusted because only a workflow on the default branch can act as it,
 * and any collaborator who could trigger such a workflow already has write access.
 */
export function senderPermission(actor: string, lookup: (login: string) => Permission): Permission {
  return actor === BOT_ACTOR ? 'write' : lookup(actor);
}

/** A requeued issue keeps its restart count so the next stale lease escalates instead of looping forever. */
export function restartsForNextClaim(previous: Lease | null): number {
  return previous ? previous.restarts : 0;
}

export function requeuedLeaseBody(lease: Lease, restarts: number): string {
  return [
    `Agent lease expired (no heartbeat since ${lease.beat.toISOString()}); the issue was put back in the queue.`,
    '',
    renderLease({ ...lease, restarts })
  ].join('\n');
}

/** No marker on purpose: a person who relabels the issue later starts with a fresh restart count. */
export function escalatedLeaseBody(reason: string, now: Date): string {
  return `Agent lease expired at ${now.toISOString()} (${reason}). Sent to a person; no marker kept.`;
}

/** `deadRun` is the Actions run of the job that died, when it has one: the next job resumes from that run's saved state. */
export function renderSweepComment(action: SweepAction, deadRun?: string): string {
  return action.action === 'requeue'
    ? `The agent job for this issue stopped sending heartbeats (${action.reason}). It was cancelled and the issue is back to \`agent:ready\`; routing runs again now (restart ${action.restarts}).${deadRun ? `\n\n${renderRequeueMarker(deadRun)}` : ''}`
    : `The agent job for this issue stopped sending heartbeats (${action.reason}). It was cancelled and not retried again. A person needs to look: check the run log, then label the issue \`agent:ready\` to try once more.`;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Month-to-date usage for the sweep's job summary. A null ledger is reported as unreadable, not as zero. */
export function renderUsage(ledger: Ledger | null, budget: Budget): string {
  if (ledger === null) {
    return '### Agent usage\nThe ledger marker is unreadable, so usage is unknown. Hosted jobs are treated as out of budget until it is fixed.';
  }
  const rows = [
    `| Hosted Actions | ${ledger.actionsMinutes} of ${budget.actionsMonthlyMinutes} min | ${pct(actionsRatio(ledger, budget))} |`,
    `| Buddy.works | ${ledger.buddyGbMinutes} of ${budget.buddyMonthlyGbMinutes} GB-min | ${budget.buddyEnabled ? pct(buddyRatio(ledger, budget)) : 'off'} |`,
    `| Oracle | ${(ledger.oracleSeconds / 3600).toFixed(1)} h | not metered |`
  ];
  return [`### Agent usage, ${ledger.month}`, '', '| Pool | Used | Share |', '|---|---|---|', ...rows].join('\n');
}

export function renderLedgerWarning(): string {
  return [
    LEDGER_WARNING_MARKER,
    'The usage ledger in this issue body has a damaged `agent-ledger` marker. Until it is repaired the router treats the hosted pool as used up,',
    'so short jobs go to Oracle or wait. To repair it, delete the whole `<!-- agent-ledger ... -->` line from the issue body; it restarts from zero.'
  ].join('\n');
}
