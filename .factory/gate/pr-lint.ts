import { Policy } from '../policy-engine';
import { classifyRisk } from '../review/risk';
import { Tier } from '../review/types';
import { checkEvidence, EvidenceIssue } from './evidence';
import { lintProse, Violation } from './prose-lint';

export interface PrLintInput {
  title: string;
  body: string;
  commits: string[];
  files: string[];
  changedLines: number;
  policy: Policy;
}

export interface PrLintReport {
  tier: Tier;
  errors: string[];
  warnings: string[];
}

function describe(where: string, v: Violation): string {
  return `${where}: ${v.rule} ("${v.match}")`;
}

/** Runs every Gate A text check. Errors fail the check; warnings are reported (and fail only in strict mode). */
export function lintPr(input: PrLintInput): PrLintReport {
  const { tier } = classifyRisk(input.policy, { files: input.files, changedLines: input.changedLines });
  const errors: string[] = [];
  const warnings: string[] = [];

  const texts: Array<[string, string]> = [['title', input.title], ['body', input.body]];
  input.commits.forEach((c, i) => texts.push([`commit ${i + 1}`, c]));
  for (const [where, text] of texts) {
    for (const v of lintProse(text)) (v.severity === 'error' ? errors : warnings).push(describe(where, v));
  }

  // A handoff note moves work between sessions on a branch. It must not reach main.
  if (input.files.includes('HANDOFF.md')) {
    errors.push('handoff-file: HANDOFF.md is a working note for moving a task between sessions; delete it from the branch before merging');
  }

  const add = (i: EvidenceIssue) => warnings.push(`${i.rule}: ${i.message}`);
  checkEvidence(input.body, tier).forEach(add);

  return { tier, errors, warnings };
}

export function renderSummary(report: PrLintReport): string {
  const lines = [`### PR text checks (${report.tier})`];
  if (!report.errors.length && !report.warnings.length) lines.push('No issues.');
  for (const e of report.errors) lines.push(`- error: ${e}`);
  for (const w of report.warnings) lines.push(`- warning: ${w}`);
  return lines.join('\n');
}
