/**
 * Zero-token prose lint for text a person will read: PR title, PR body, commit messages.
 * Errors are repo rules (no attribution lines). Warnings are AI tells that make text read machine-made.
 */

export type Severity = 'error' | 'warning';

export interface Violation {
  rule: string;
  severity: Severity;
  match: string;
}

interface Rule {
  rule: string;
  severity: Severity;
  pattern: RegExp;
}

const RULES: Rule[] = [
  { rule: 'attribution', severity: 'error', pattern: /generated (?:with|by)\b[^\n]{0,40}claude/i },
  { rule: 'attribution', severity: 'error', pattern: /co-authored-by:\s*claude/i },
  { rule: 'attribution', severity: 'error', pattern: /claude\.(?:ai|com)\/code/i },
  { rule: 'attribution', severity: 'error', pattern: /\bsession_[0-9A-Za-z]{10,}/ },
  { rule: 'em-dash', severity: 'warning', pattern: /—/ },
  { rule: 'chatbot-phrase', severity: 'warning', pattern: /\b(?:i hope this helps|great question|certainly!|as an ai\b|let me know if|feel free to)/i },
  { rule: 'filler', severity: 'warning', pattern: /\b(?:it(?:'|’)s|it is) (?:worth|important to) not(?:e|ing)\b|\bin conclusion\b|\bin today(?:'|’)s\b/i },
  { rule: 'puffery', severity: 'warning', pattern: /\b(?:delve|seamless(?:ly)?|game-changer|cutting-edge|state-of-the-art|revolutionary|elevate|unlock the (?:power|potential))\b/i }
];

/** Removes fenced code, inline code and HTML comments so quoted code and markers never trigger rules. */
export function stripNonProse(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

export function lintProse(text: string): Violation[] {
  const prose = stripNonProse(text);
  const out: Violation[] = [];
  for (const r of RULES) {
    const m = r.pattern.exec(prose);
    if (m) out.push({ rule: r.rule, severity: r.severity, match: m[0].slice(0, 60) });
  }
  return out;
}
