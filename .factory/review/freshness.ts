import { ReviewResult } from './types';

/**
 * A review only counts for the commit it ran against. Pure helper used by writers and by the
 * reviewer itself to avoid reusing a score from an earlier push.
 */
export function isFresh(result: Pick<ReviewResult, 'head_sha' | 'status'>, currentHead: string): boolean {
  return result.status === 'complete' && result.head_sha === currentHead;
}

/** Attempt numbers continue per PR; a new head still increments so the history stays ordered. */
export function nextAttempt(previous: Array<Pick<ReviewResult, 'attempt'>>): number {
  return previous.reduce((max, r) => Math.max(max, r.attempt), 0) + 1;
}

/** True when the same finding (file, category, quote) was already reported on an earlier attempt. */
export function isRepeat(
  finding: { file: string; category: string; evidence_quote: string },
  earlier: Array<{ file: string; category: string; evidence_quote: string }>
): boolean {
  const key = (f: { file: string; category: string; evidence_quote: string }) =>
    `${f.file}\u0000${f.category}\u0000${f.evidence_quote.replace(/\s+/g, ' ').trim()}`;
  const seen = new Set(earlier.map(key));
  return seen.has(key(finding));
}
