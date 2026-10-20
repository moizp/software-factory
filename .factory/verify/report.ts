import { redact } from './redact';
import { Row, Status, Tier } from './types';

export interface Meta {
  generatedAt: string;
  factoryCommit: string;
  factoryBranch: string;
  node: string;
  os: string;
  claude: string;
  gh: string;
  projectDir: string;
  tiers: Tier[];
  flags: string;
}

export const BEGIN = '<!-- BEGIN FACTORY VERIFY REPORT -->';
export const END = '<!-- END FACTORY VERIFY REPORT -->';

export function counts(rows: Row[]): Record<Status, number> {
  const c: Record<Status, number> = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

/** Non-zero when anything failed. Warnings and skips do not fail a run. */
export const exitCode = (rows: Row[]): 0 | 1 => (rows.some(r => r.status === 'fail') ? 1 : 0);

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

export function nextSteps(rows: Row[]): string[] {
  return [...new Set(rows.filter(r => r.status !== 'pass' && r.next).map(r => r.next as string))];
}

/** The whole report as markdown, between markers, with anything credential-shaped removed. */
export function renderReport(meta: Meta, rows: Row[]): string {
  const c = counts(rows);
  const lines: string[] = [
    BEGIN,
    '# Factory verification report',
    '',
    `- Generated: ${meta.generatedAt}`,
    `- Factory: ${meta.factoryCommit} on ${meta.factoryBranch}`,
    `- Project: ${meta.projectDir}`,
    `- Environment: Node ${meta.node}, ${meta.os}, claude ${meta.claude}, gh ${meta.gh}`,
    `- Ran: ${meta.tiers.join(', ')}${meta.flags ? ` (${meta.flags})` : ''}`,
    '',
    `**Result: ${c.pass} pass, ${c.warn} warn, ${c.fail} fail, ${c.skip} skip**`,
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...rows.map(r => `| ${r.id} | ${r.status.toUpperCase()} | ${cell(r.detail)} |`)
  ];

  const attention = rows.filter(r => r.status === 'fail' || r.status === 'warn');
  if (attention.length > 0) {
    lines.push('', '## Needs attention');
    for (const r of attention) {
      lines.push('', `### ${r.id} (${r.status.toUpperCase()}): ${r.title}`, '', r.detail);
      if (r.extra) lines.push('', '```', r.extra.trimEnd(), '```');
      if (r.next) lines.push('', `Next: ${r.next}`);
    }
  }

  const steps = nextSteps(rows);
  if (steps.length > 0) lines.push('', '## Next steps', '', ...steps.map((s, i) => `${i + 1}. ${s}`));
  lines.push(END);
  return redact(lines.join('\n'));
}
