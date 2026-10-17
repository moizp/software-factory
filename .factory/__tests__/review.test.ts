import * as path from 'path';
import { STRICT_POLICY, Policy } from '../policy-engine';
import { groundFindings, diffByFile } from '../review/grounding';
import { isFresh, isRepeat, nextAttempt } from '../review/freshness';
import { addUsage, dailyCapReached, emptyUsage, monthlyBudgetReached } from '../review/ledger';
import { classifyRisk } from '../review/risk';
import { parseLensOutput } from '../review/schema';
import { ApiRunner, buildReviewCliArgs } from '../review/runners';
import { HAIKU, SONNET, labelsFor, lensesFor, renderComment, runReview, verdictFrom, MAX_DIFF_CHARS } from '../review/review';
import { Finding, LensOutput, Runner, RunnerRequest } from '../review/types';

const policy: Policy = { ...STRICT_POLICY, protected_paths: ['.factory/**', '.github/**'] };

const DIFF = [
  'diff --git a/src/pay.ts b/src/pay.ts',
  '--- a/src/pay.ts',
  '+++ b/src/pay.ts',
  '@@ -1,3 +1,4 @@',
  ' export function total(items: number[]) {',
  '-  return items.reduce((a, b) => a + b);',
  '+  return items.reduce((a, b) => a + b, 0);',
  ' }'
].join('\n');

function finding(over: Partial<Finding> = {}): Finding {
  return {
    severity: 'major', category: 'logic', file: 'src/pay.ts', line: 2,
    evidence_quote: 'items.reduce((a, b) => a + b, 0)', explanation: 'x', suggested_fix: 'y', confidence: 'high', ...over
  };
}

function lens(findings: Finding[] = [], verdict: LensOutput['verdict'] = 'approve'): LensOutput {
  return { verdict, risk_assessment: 'ok', claims_check: [], findings, needs_context: [] };
}

class FakeRunner implements Runner {
  readonly kind = 'cli' as const;
  calls: RunnerRequest[] = [];
  constructor(private readonly respond: (req: RunnerRequest, n: number) => LensOutput | Error) {}
  async run(req: RunnerRequest) {
    this.calls.push(req);
    const out = this.respond(req, this.calls.length);
    if (out instanceof Error) throw out;
    return { text: JSON.stringify(out), usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, costUsd: 0.01 } };
  }
}

const base = {
  pr: 7, headSha: 'abc1234', attempt: 1, title: 't', body: 'b', diff: DIFF,
  files: ['src/pay.ts'], changedLines: 2, policy,
  promptsDir: path.join(__dirname, '..', '..', 'templates', 'ai-review', 'prompts')
};

describe('classifyRisk', () => {
  it('docs and tests only is R0', () => {
    expect(classifyRisk(policy, { files: ['README.md', 'docs/a.md', 'src/a.test.ts'], changedLines: 400 }).tier).toBe('R0');
  });
  it('small local change is R1', () => {
    expect(classifyRisk(policy, { files: ['src/a.ts', 'src/b.ts'], changedLines: 40 }).tier).toBe('R1');
  });
  it('dependency file, size or spread raises to R2', () => {
    expect(classifyRisk(policy, { files: ['package.json', 'src/a.ts'], changedLines: 5 }).tier).toBe('R2');
    expect(classifyRisk(policy, { files: ['src/a.ts'], changedLines: 250 }).tier).toBe('R2');
    expect(classifyRisk(policy, { files: ['a/x.ts', 'b/y.ts', 'c/z.ts'], changedLines: 10 }).tier).toBe('R2');
  });
  it('protected, sensitive or huge changes are R3', () => {
    expect(classifyRisk(policy, { files: ['.github/workflows/x.yml'], changedLines: 1 }).tier).toBe('R3');
    expect(classifyRisk(policy, { files: ['src/auth/login.ts'], changedLines: 3 }).tier).toBe('R3');
    expect(classifyRisk(policy, { files: ['db/migrations/001.sql'], changedLines: 3 }).tier).toBe('R3');
    expect(classifyRisk(policy, { files: ['src/a.ts'], changedLines: 700 }).tier).toBe('R3');
  });
  it('a tests-only change touching a sensitive path is still R3', () => {
    expect(classifyRisk(policy, { files: ['src/auth/login.test.ts'], changedLines: 3 }).tier).toBe('R3');
  });
  it('an empty change is R0', () => {
    expect(classifyRisk(policy, { files: [], changedLines: 0 }).tier).toBe('R0');
  });
});

describe('grounding', () => {
  it('keeps findings whose quote is in that file of the diff', () => {
    const g = groundFindings(DIFF, [finding()]);
    expect(g.kept).toHaveLength(1);
    expect(g.dropped).toHaveLength(0);
  });
  it('ignores whitespace differences', () => {
    expect(groundFindings(DIFF, [finding({ evidence_quote: 'items.reduce((a, b) =>\n    a + b, 0)' })]).kept).toHaveLength(1);
  });
  it('drops invented quotes, wrong files and trivial quotes', () => {
    const g = groundFindings(DIFF, [
      finding({ evidence_quote: 'await db.query(sql)' }),
      finding({ file: 'src/other.ts' }),
      finding({ evidence_quote: 'a' })
    ]);
    expect(g.kept).toHaveLength(0);
    expect(g.dropped).toHaveLength(3);
  });
  it('splits the diff by new path and skips headers', () => {
    const files = diffByFile(DIFF);
    expect([...files.keys()]).toEqual(['src/pay.ts']);
    expect(files.get('src/pay.ts')).not.toContain('@@');
  });
});

describe('freshness', () => {
  it('only a complete review of the current head is fresh', () => {
    expect(isFresh({ head_sha: 'a', status: 'complete' }, 'a')).toBe(true);
    expect(isFresh({ head_sha: 'a', status: 'complete' }, 'b')).toBe(false);
    expect(isFresh({ head_sha: 'a', status: 'degraded' }, 'a')).toBe(false);
  });
  it('numbers attempts and spots repeats', () => {
    expect(nextAttempt([])).toBe(1);
    expect(nextAttempt([{ attempt: 1 }, { attempt: 3 }])).toBe(4);
    const f = { file: 'a', category: 'logic', evidence_quote: 'x  y' };
    expect(isRepeat(f, [{ file: 'a', category: 'logic', evidence_quote: 'x y' }])).toBe(true);
    expect(isRepeat(f, [{ file: 'b', category: 'logic', evidence_quote: 'x y' }])).toBe(false);
  });
});

describe('ledger', () => {
  it('applies the daily cap and the monthly budget', () => {
    expect(dailyCapReached(20, 20)).toBe(true);
    expect(dailyCapReached(19, 20)).toBe(false);
    expect(dailyCapReached(99, 0)).toBe(false);
    expect(dailyCapReached(99, NaN)).toBe(false);
    expect(monthlyBudgetReached(25, 25)).toBe(true);
    expect(monthlyBudgetReached(1, 25)).toBe(false);
  });
  it('adds usage', () => {
    const u = addUsage(emptyUsage(), { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, costUsd: 0.5 });
    expect(u).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, costUsd: 0.5 });
  });
});

describe('parseLensOutput', () => {
  it('accepts plain and fenced JSON', () => {
    const text = JSON.stringify(lens([finding()]));
    expect(parseLensOutput(text).findings).toHaveLength(1);
    expect(parseLensOutput('```json\n' + text + '\n```').findings).toHaveLength(1);
  });
  it('rejects non-JSON and schema violations', () => {
    expect(() => parseLensOutput('looks fine to me')).toThrow('not valid JSON');
    expect(() => parseLensOutput(JSON.stringify({ verdict: 'maybe' }))).toThrow('schema');
    expect(() => parseLensOutput(JSON.stringify(lens([{ ...finding(), severity: 'huge' as any }])))).toThrow('schema');
  });
});

describe('verdictFrom', () => {
  it('approves with no solid findings, including low confidence ones', () => {
    expect(verdictFrom([], ['approve'])).toBe('approve');
    expect(verdictFrom([finding({ confidence: 'low' })], ['request_changes'])).toBe('approve');
    expect(verdictFrom([finding({ severity: 'minor' })], ['approve'])).toBe('approve');
  });
  it('requests changes on a major or blocker and blocks only when grounded and the model said block', () => {
    expect(verdictFrom([finding()], ['approve'])).toBe('request_changes');
    expect(verdictFrom([finding({ severity: 'blocker' })], ['approve'])).toBe('request_changes');
    expect(verdictFrom([finding({ severity: 'blocker' })], ['block'])).toBe('block');
    expect(verdictFrom([], ['block'])).toBe('approve');
  });
});

describe('runReview', () => {
  it('R0 skips the model and approves', async () => {
    const runner = new FakeRunner(() => lens());
    const r = await runReview({ ...base, files: ['README.md'] }, runner);
    expect(r.tier).toBe('R0');
    expect(r.status).toBe('complete');
    expect(r.verdict).toBe('approve');
    expect(runner.calls).toHaveLength(0);
  });

  it('fails closed with no credential and for an oversized diff', async () => {
    const none = await runReview(base, null);
    expect(none.status).toBe('failed_closed');
    expect(none.verdict).toBe('block');
    const big = await runReview({ ...base, diff: 'x'.repeat(MAX_DIFF_CHARS + 1) }, new FakeRunner(() => lens()));
    expect(big.status).toBe('failed_closed');
    expect(big.notes[0]).toContain('over the');
  });

  it('fails closed when the prompts are missing', async () => {
    const r = await runReview({ ...base, promptsDir: '/nonexistent' }, new FakeRunner(() => lens()));
    expect(r.status).toBe('failed_closed');
  });

  it('R1 uses Haiku without effort and stays there when clean', async () => {
    const runner = new FakeRunner(() => lens());
    const r = await runReview(base, runner);
    expect(r.tier).toBe('R1');
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].model).toBe(HAIKU);
    expect(runner.calls[0].effort).toBeUndefined();
    expect(r.verdict).toBe('approve');
    expect(r.head_sha).toBe('abc1234');
    expect(r.attempt).toBe(1);
  });

  it('R1 re-runs on Sonnet medium after a grounded major finding', async () => {
    const runner = new FakeRunner(req => (req.model === HAIKU ? lens([finding()], 'request_changes') : lens([finding()], 'request_changes')));
    const r = await runReview(base, runner);
    expect(runner.calls.map(c => c.model)).toEqual([HAIKU, SONNET]);
    expect(runner.calls[1].effort).toBe('medium');
    expect(r.verdict).toBe('request_changes');
    expect(r.models).toEqual([HAIKU, SONNET]);
  });

  it('does not re-run when the first-pass finding is ungrounded', async () => {
    const runner = new FakeRunner(() => lens([finding({ evidence_quote: 'invented line of code' })], 'request_changes'));
    const r = await runReview(base, runner);
    expect(runner.calls).toHaveLength(1);
    expect(r.findings).toHaveLength(0);
    expect(r.dropped_ungrounded).toBe(1);
    expect(r.verdict).toBe('approve');
  });

  it('R2 runs three lenses on Sonnet; R3 adds architecture', async () => {
    const r2 = new FakeRunner(() => lens());
    await runReview({ ...base, files: ['package.json', 'src/a.ts'] }, r2);
    expect(r2.calls).toHaveLength(3);
    expect(r2.calls.every(c => c.model === SONNET && c.effort === 'medium')).toBe(true);
    const r3 = new FakeRunner(() => lens());
    await runReview({ ...base, files: ['.github/workflows/x.yml'] }, r3);
    expect(r3.calls).toHaveLength(4);
  });

  it('a failed lens degrades and never approves', async () => {
    const runner = new FakeRunner((_r, n) => (n === 2 ? new Error('boom') : lens()));
    const r = await runReview({ ...base, files: ['package.json', 'src/a.ts'] }, runner);
    expect(r.status).toBe('degraded');
    expect(r.verdict).toBe('request_changes');
    expect(r.notes[0]).toContain('boom');
  });

  it('every lens failing fails closed, and bad model output counts as a failure', async () => {
    const r = await runReview(base, { kind: 'cli', run: async () => ({ text: 'fine!', usage: emptyUsage() }) });
    expect(r.status).toBe('failed_closed');
    expect(r.verdict).toBe('block');
  });

  it('puts the diff and claims in fenced data blocks, with the system rubric separate', async () => {
    const runner = new FakeRunner(() => lens());
    await runReview(base, runner);
    expect(runner.calls[0].prompt).toContain('<diff>');
    expect(runner.calls[0].prompt).toContain('<pr_claims>');
    expect(runner.calls[0].system).toContain('Evidence or silence');
  });
});

describe('lensesFor, labelsFor, renderComment', () => {
  it('maps tiers to lenses', () => {
    expect(lensesFor('R0')).toEqual([]);
    expect(lensesFor('R1')).toEqual(['logic+security']);
    expect(lensesFor('R3')).toContain('architecture');
  });
  it('shadow mode applies only the risk label', async () => {
    const r = await runReview(base, null);
    expect(labelsFor(r, true)).toEqual(['risk:r1']);
    expect(labelsFor(r, false)).toEqual(['risk:r1', 'ai-review:blocked', 'policy:manual']);
  });
  it('enforce mode labels by verdict', async () => {
    const pass = await runReview(base, new FakeRunner(() => lens()));
    expect(labelsFor(pass, false)).toEqual(['risk:r1', 'ai-review:pass']);
    const changes = await runReview(base, new FakeRunner(() => lens([finding()], 'request_changes')));
    expect(labelsFor(changes, false)).toEqual(['risk:r1', 'ai-review:changes']);
  });
  it('renders findings, drop counts and the machine marker', async () => {
    const r = await runReview(base, new FakeRunner(() => lens([finding(), finding({ evidence_quote: 'made up text here' })], 'request_changes')));
    const md = renderComment(r);
    expect(md).toContain('major: logic (src/pay.ts:2');
    expect(md).toContain('1 finding(s) dropped');
    expect(md).toContain('<!-- ai-review head=abc1234 attempt=1 -->');
  });
});

describe('runners', () => {
  it('builds CLI args that are tool-less, stateless and schema-bound, never bare', () => {
    const args = buildReviewCliArgs({ model: SONNET, effort: 'medium', system: 'S', prompt: 'P' });
    expect(args).toEqual(expect.arrayContaining(['-p', '--tools', '', '--no-session-persistence', '--json-schema', '--effort', 'medium']));
    expect(args).not.toContain('--bare');
    expect(buildReviewCliArgs({ model: HAIKU, system: 'S', prompt: 'P' })).not.toContain('--effort');
  });

  it('API runner posts the request and reads text and usage', async () => {
    let seen: any;
    const runner = new ApiRunner('k', async (url, init) => {
      seen = { url, init };
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 4, output_tokens: 2 } })
      };
    });
    const res = await runner.run({ model: HAIKU, system: 'S', prompt: 'P' });
    expect(res.text).toBe('{"a":1}');
    expect(res.usage.inputTokens).toBe(4);
    expect(seen.init.headers['x-api-key']).toBe('k');
    expect(JSON.parse(seen.init.body).output_config).toBeUndefined();
  });

  it('API runner throws on HTTP errors and early stops', async () => {
    const bad = new ApiRunner('k', async () => ({ ok: false, status: 429, text: async () => 'slow down', json: async () => ({}) }));
    await expect(bad.run({ model: SONNET, system: 'S', prompt: 'P' })).rejects.toThrow('429');
    const refused = new ApiRunner('k', async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ stop_reason: 'refusal' }) }));
    await expect(refused.run({ model: SONNET, system: 'S', prompt: 'P' })).rejects.toThrow('refusal');
  });
});
