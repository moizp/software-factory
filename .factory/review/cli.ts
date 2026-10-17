import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { loadPolicy } from '../policy-engine';
import { dailyCapReached, ledgerLine } from './ledger';
import { labelsFor, renderComment, runReview } from './review';
import { ApiRunner, CliRunner } from './runners';
import { ReviewResult, Runner } from './types';

/**
 * Entry point for the ai-review workflow. Runs on the BASE branch checkout, reads the PR as data
 * (diff, numstat, metadata files), and never executes PR code. Any error leaves the PR for a human.
 *
 * Env: PR_NUMBER, BASE_REF, HEAD_SHA, REVIEW_DIFF, REVIEW_NUMSTAT, REVIEW_PR, REVIEW_RUNNER (cli|api),
 *      REVIEW_MODE (shadow by default, "enforce" to apply verdict labels), DAILY_REVIEW_CAP, REVIEW_OUT.
 */

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function parseNumstat(text: string): { files: string[]; lines: number } {
  const files: string[] = [];
  let lines = 0;
  for (const row of text.split('\n').filter(Boolean)) {
    const [a, r, ...rest] = row.split('\t');
    files.push(rest.join('\t'));
    lines += (parseInt(a, 10) || 0) + (parseInt(r, 10) || 0);
  }
  return { files, lines };
}

/** Attempt number continues from earlier review comments on this PR. */
function previousAttempts(pr: number): number {
  try {
    const out = gh(['pr', 'view', String(pr), '--json', 'comments', '--jq', '.comments[].body']);
    const nums = Array.from(out.matchAll(/<!-- ai-review head=\w+ attempt=(\d+) -->/g)).map(m => parseInt(m[1], 10));
    return nums.length ? Math.max(...nums) : 0;
  } catch {
    return 0;
  }
}

function reviewsToday(): number {
  const since = new Date().toISOString().slice(0, 10);
  const out = gh(['run', 'list', '--workflow', 'ai-review.yml', '--created', `>=${since}`, '--json', 'databaseId', '--limit', '200']);
  return (JSON.parse(out) as unknown[]).length;
}

function makeRunner(): Runner | null {
  const kind = process.env.REVIEW_RUNNER;
  if (kind === 'cli') return new CliRunner();
  if (kind === 'api' && process.env.ANTHROPIC_API_KEY) return new ApiRunner(process.env.ANTHROPIC_API_KEY);
  return null;
}

async function main(): Promise<void> {
  const pr = parseInt(required('PR_NUMBER'), 10);
  const headSha = required('HEAD_SHA');
  const baseRef = required('BASE_REF');
  const shadow = process.env.REVIEW_MODE !== 'enforce';
  const outDir = process.env.REVIEW_OUT || process.env.RUNNER_TEMP || '.';

  const meta = JSON.parse(fs.readFileSync(required('REVIEW_PR'), 'utf-8')) as { title: string; body: string };
  const { files, lines } = parseNumstat(fs.readFileSync(required('REVIEW_NUMSTAT'), 'utf-8'));
  const diff = fs.readFileSync(required('REVIEW_DIFF'), 'utf-8');
  const attempt = previousAttempts(pr) + 1;

  const base = {
    pr, headSha, attempt, title: meta.title ?? '', body: meta.body ?? '', diff, files, changedLines: lines,
    policy: loadPolicy(`origin/${baseRef}`),
    promptsDir: path.join(process.cwd(), 'templates', 'ai-review', 'prompts')
  };

  let result: ReviewResult;
  try {
    const capped = dailyCapReached(reviewsToday(), Number(process.env.DAILY_REVIEW_CAP));
    result = capped
      ? { ...(await runReview(base, null)), notes: ['daily review cap reached'] }
      : await runReview(base, makeRunner());
  } catch (e) {
    result = { ...(await runReview(base, null)), notes: [`review errored: ${(e as Error).message}`] };
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'review-result.json'), JSON.stringify(result, null, 2));
  fs.appendFileSync(path.join(outDir, 'ledger.jsonl'), ledgerLine({
    pr, head_sha: headSha, attempt, tier: result.tier, runner: result.runner, usage: result.usage
  }) + '\n');

  const bodyFile = path.join(outDir, 'review-comment.md');
  fs.writeFileSync(bodyFile, renderComment(result));
  gh(['pr', 'comment', String(pr), '--body-file', bodyFile]);
  for (const label of labelsFor(result, shadow)) {
    try { gh(['pr', 'edit', String(pr), '--add-label', label]); } catch { /* label may not exist yet */ }
  }
  console.log(`review ${result.status}: ${result.verdict} (${result.tier}) shadow=${shadow}`);
}

main().catch(e => {
  // Last resort: never leave the PR looking reviewed.
  console.error(`ai-review failed: ${(e as Error).message}`);
  try { gh(['pr', 'edit', String(process.env.PR_NUMBER), '--add-label', 'policy:manual']); } catch { /* ignore */ }
  process.exit(0);
});
