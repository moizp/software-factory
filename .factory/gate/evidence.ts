import { Tier } from '../review/types';

export interface EvidenceIssue {
  rule: string;
  message: string;
}

const PLACEHOLDER = /^(?:todo|tbd|n\/?a|none|-|\.\.\.|x)$/i;

/** Returns the text under a heading whose title matches `title` (any level), or null if absent. */
export function section(body: string, title: RegExp): string | null {
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(lines[i]);
    if (m && title.test(m[1])) { start = i + 1; break; }
  }
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function substantive(text: string | null): boolean {
  if (!text) return false;
  const flat = text.replace(/^[-*\s[\]x]+/gm, '').replace(/\s+/g, ' ').trim();
  return flat.length >= 12 && !PLACEHOLDER.test(flat);
}

/** True when the text names something concrete: a command in backticks, or a count or result of checks. */
function concrete(text: string): boolean {
  return /`[^`]+`/.test(text) || /\b\d+\s+(?:tests?\s+)?(?:pass|passed|passing)\b/i.test(text) || /\bpass(?:es|ed)?\b/i.test(text);
}

const TESTING = /^(?:testing|tests?|how it was verified|verification|evidence)\b/i;
const ROLLBACK = /^(?:rollback|roll back|backout|how to undo)\b/i;

/**
 * Evidence expected in the PR body, scaled by risk tier (same proportionality idea as the review tiers):
 * R0 nothing, R1 a Testing section with substance, R2 and R3 name concrete checks, R3 also a Rollback section.
 */
export function checkEvidence(body: string, tier: Tier): EvidenceIssue[] {
  if (tier === 'R0') return [];
  const issues: EvidenceIssue[] = [];

  const testing = section(body, TESTING);
  if (!substantive(testing)) {
    issues.push({ rule: 'evidence-missing', message: `${tier} change needs a Testing section saying what was run and the result` });
  } else if ((tier === 'R2' || tier === 'R3') && !concrete(testing as string)) {
    issues.push({ rule: 'evidence-vague', message: `${tier} change needs a concrete check in Testing (a command in backticks or a pass count)` });
  }

  if (tier === 'R3' && !substantive(section(body, ROLLBACK))) {
    issues.push({ rule: 'rollback-missing', message: 'R3 change needs a Rollback section saying how to undo it safely' });
  }
  return issues;
}
