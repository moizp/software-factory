import { Policy } from '../policy-engine';
import { classifyRisk } from '../review/risk';
import { Tier } from '../review/types';
import { checkVisualEvidence } from '../evidence/ui-paths';
import { checkEvidence, EvidenceIssue } from './evidence';
import { checkAuthorHooks, checkIdentity, checkLayoutProof, checkScratchFiles, CommitIdentity, Identity, reviewLayoutDiff, LayoutIssue } from './layout';
import { lintProse, Violation } from './prose-lint';

export interface PrLintInput {
  title: string;
  body: string;
  commits: string[];
  files: string[];
  changedLines: number;
  policy: Policy;
  /** Interface-work gates (optional so a caller without git can skip them). */
  branch?: string;
  /** `git diff --unified=0 base...head`, read for relaxed limits, skipped tests and hooks that change the author. */
  diff?: string;
  /** Files added or changed (not deleted): checked for scratch and log files. */
  addedFiles?: string[];
  commitIdentities?: CommitIdentity[];
  /** The identity the owner specified; nothing is checked when it is not set. */
  identity?: Identity | null;
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
  for (const v of checkVisualEvidence(input.body, input.files, tier)) (v.severity === 'error' ? errors : warnings).push(`${v.rule}: ${v.message}`);

  const layout: LayoutIssue[] = [
    ...checkLayoutProof(input.body, { branch: input.branch ?? '', title: input.title, files: input.files, tier }),
    ...(input.diff ? [...reviewLayoutDiff(input.diff), ...checkAuthorHooks(input.diff)] : []),
    ...checkScratchFiles(input.addedFiles ?? input.files),
    ...checkIdentity(input.commitIdentities ?? [], input.identity ?? null)
  ];
  for (const v of layout) (v.severity === 'error' ? errors : warnings).push(`${v.rule}: ${v.message}`);

  return { tier, errors, warnings };
}

export function renderSummary(report: PrLintReport): string {
  const lines = [`### PR text checks (${report.tier})`];
  if (!report.errors.length && !report.warnings.length) lines.push('No issues.');
  for (const e of report.errors) lines.push(`- error: ${e}`);
  for (const w of report.warnings) lines.push(`- warning: ${w}`);
  return lines.join('\n');
}
