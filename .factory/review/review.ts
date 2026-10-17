import * as fs from 'fs';
import * as path from 'path';
import { Policy } from '../policy-engine';
import { groundFindings } from './grounding';
import { addUsage, emptyUsage } from './ledger';
import { classifyRisk } from './risk';
import { parseLensOutput } from './schema';
import {
  Finding, LensOutput, ReviewResult, ReviewStatus, Runner, RunnerRequest, Tier, Verdict
} from './types';

export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-4-5';
/** Diffs above this are not sent: a human reviews them (cost and context limits). */
export const MAX_DIFF_CHARS = 150_000;

const LENS_FILES: Record<string, string> = {
  logic: '20-logic.md',
  security: '30-security.md',
  architecture: '40-architecture.md',
  docs: '50-docs-sync.md'
};

/** Which lenses run per tier. R1 is one combined pass (logic plus security). */
export function lensesFor(tier: Tier): string[] {
  switch (tier) {
    case 'R0': return [];
    case 'R1': return ['logic+security'];
    case 'R2': return ['logic', 'security', 'docs'];
    case 'R3': return ['logic', 'security', 'architecture', 'docs'];
  }
}

export function loadPrompt(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf-8');
}

function lensPrompt(dir: string, lens: string): string {
  return lens
    .split('+')
    .map(l => loadPrompt(dir, LENS_FILES[l]))
    .join('\n\n');
}

export interface ReviewInput {
  pr: number;
  headSha: string;
  attempt: number;
  title: string;
  body: string;
  diff: string;
  files: string[];
  changedLines: number;
  policy: Policy;
  promptsDir: string;
}

function worst(a: Verdict, b: Verdict): Verdict {
  const rank: Record<Verdict, number> = { approve: 0, request_changes: 1, block: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** Recomputes the verdict from grounded findings so an ungrounded model verdict cannot pass or block. */
export function verdictFrom(findings: Finding[], modelVerdicts: Verdict[]): Verdict {
  const solid = findings.filter(f => f.confidence !== 'low');
  let v: Verdict = 'approve';
  if (solid.some(f => f.severity === 'major')) v = 'request_changes';
  if (solid.some(f => f.severity === 'blocker')) v = 'request_changes';
  // A blocker that needs a human decision stays a block when the model said so and the finding survived grounding.
  if (modelVerdicts.includes('block') && solid.some(f => f.severity === 'blocker')) v = 'block';
  return v;
}

function failClosed(
  input: ReviewInput, tier: Tier, reasons: string[], runner: ReviewResult['runner'], note: string
): ReviewResult {
  return {
    pr: input.pr, head_sha: input.headSha, attempt: input.attempt, status: 'failed_closed',
    verdict: 'block', tier, tier_reasons: reasons, runner, models: [], findings: [],
    dropped_ungrounded: 0, claims_check: [], needs_context: [], usage: emptyUsage(), notes: [note]
  };
}

function buildPrompt(input: ReviewInput, tier: Tier, lens: string, dir: string): string {
  // The PR text is a claim to verify and the diff is data; both are fenced so neither reads as instructions.
  return [
    `Risk tier: ${tier}`,
    '<pr_claims>', `Title: ${input.title}`, input.body, '</pr_claims>',
    '<diff>', input.diff, '</diff>',
    lensPrompt(dir, lens)
  ].join('\n');
}

/**
 * Runs the review for one PR head. Any error, refusal, invalid output or oversized diff fails closed
 * to a human. Returns a complete result otherwise; a failed lens yields `degraded`, never `approve`.
 */
export async function runReview(input: ReviewInput, runner: Runner | null): Promise<ReviewResult> {
  const risk = classifyRisk(input.policy, { files: input.files, changedLines: input.changedLines });
  const { tier } = risk;
  const kind = runner?.kind ?? 'none';

  if (tier === 'R0') {
    return {
      ...failClosed(input, tier, risk.reasons, kind, 'R0: no model review needed'),
      status: 'complete', verdict: 'approve', notes: []
    };
  }
  if (!runner) return failClosed(input, tier, risk.reasons, kind, 'no Claude credential available');
  if (input.diff.length > MAX_DIFF_CHARS) {
    return failClosed(input, tier, risk.reasons, kind, `diff is ${input.diff.length} chars, over the ${MAX_DIFF_CHARS} limit`);
  }

  let system: string;
  try {
    system = loadPrompt(input.promptsDir, '00-system.md');
  } catch (e) {
    return failClosed(input, tier, risk.reasons, kind, `prompts unavailable: ${(e as Error).message}`);
  }

  const models = new Set<string>();
  let usage = emptyUsage();
  const outputs: LensOutput[] = [];
  const notes: string[] = [];

  const call = async (lens: string, model: string): Promise<LensOutput> => {
    const req: RunnerRequest = {
      model,
      effort: model === HAIKU ? undefined : 'medium',
      system,
      prompt: buildPrompt(input, tier, lens, input.promptsDir)
    };
    const res = await runner.run(req);
    models.add(model);
    usage = addUsage(usage, res.usage);
    return parseLensOutput(res.text);
  };

  for (const lens of lensesFor(tier)) {
    const firstModel = tier === 'R1' ? HAIKU : SONNET;
    try {
      let out = await call(lens, firstModel);
      // R1 starts cheap; a major finding or low confidence earns a re-run on the stronger model.
      if (firstModel === HAIKU) {
        const grounded = groundFindings(input.diff, out.findings).kept;
        if (grounded.some(f => f.severity !== 'minor' || f.confidence === 'low')) out = await call(lens, SONNET);
      }
      outputs.push({ ...out, findings: out.findings.map(f => ({ ...f, lens })) });
    } catch (e) {
      notes.push(`lens ${lens} failed: ${(e as Error).message}`);
    }
  }

  if (outputs.length === 0) {
    return { ...failClosed(input, tier, risk.reasons, kind, notes.join('; ')), models: [...models], usage };
  }

  const all = outputs.flatMap(o => o.findings);
  const { kept, dropped } = groundFindings(input.diff, all);
  const status: ReviewStatus = notes.length ? 'degraded' : 'complete';
  let verdict = verdictFrom(kept, outputs.map(o => o.verdict));
  // A degraded review never approves: a missing lens might have found the blocker.
  if (status === 'degraded') verdict = worst(verdict, 'request_changes');

  return {
    pr: input.pr, head_sha: input.headSha, attempt: input.attempt, status, verdict, tier,
    tier_reasons: risk.reasons, runner: kind, models: [...models], findings: kept,
    dropped_ungrounded: dropped.length,
    claims_check: outputs.flatMap(o => o.claims_check),
    needs_context: Array.from(new Set(outputs.flatMap(o => o.needs_context))),
    usage, notes
  };
}

/** Labels the workflow applies. In shadow mode only the risk label is applied. */
export function labelsFor(result: ReviewResult, shadow: boolean): string[] {
  const labels = [`risk:${result.tier.toLowerCase()}`];
  if (shadow) return labels;
  if (result.status === 'failed_closed' || result.status === 'degraded') {
    labels.push('ai-review:blocked', 'policy:manual');
  } else if (result.verdict === 'approve') labels.push('ai-review:pass');
  else if (result.verdict === 'request_changes') labels.push('ai-review:changes');
  else labels.push('ai-review:blocked', 'policy:manual');
  return labels;
}

export function renderComment(result: ReviewResult): string {
  const lines = [
    `## AI review (${result.tier}, attempt ${result.attempt})`,
    `Commit \`${result.head_sha.slice(0, 7)}\` · verdict **${result.verdict}** · status ${result.status} · runner ${result.runner}`,
    ''
  ];
  if (result.notes.length) lines.push(...result.notes.map(n => `- Note: ${n}`), '');
  if (result.findings.length === 0) lines.push('No grounded findings.');
  for (const f of result.findings) {
    lines.push(`### ${f.severity}: ${f.category} (${f.file}:${f.line}, ${f.confidence} confidence)`);
    lines.push('```', f.evidence_quote, '```', f.explanation, '', `Suggested fix: ${f.suggested_fix}`, '');
  }
  if (result.dropped_ungrounded) lines.push(`_${result.dropped_ungrounded} finding(s) dropped: the quoted evidence was not in the diff._`);
  lines.push('', `<!-- ai-review head=${result.head_sha} attempt=${result.attempt} -->`);
  return lines.join('\n');
}
