import { stubPayload } from '../contracts';
import {
  CONTEXT_ORDER, compactArtifacts, describePack, orderKeys, packContext, shrinkValue
} from '../context';
import { estimateTokens } from '../prompts';
import { FactoryOrchestrator } from '../orchestrator';
import { retryConfig } from './fixtures';

const big = (n: number) => 'word '.repeat(n);

describe('orderKeys', () => {
  it('puts stable keys first and the rest after, alphabetically', () => {
    const keys = Object.keys(orderKeys({ zeta: 1, humanAnswers: [], architectOutput: {}, brief: 'b', alpha: 2, productManagerOutput: {} }));
    expect(keys).toEqual(['brief', 'productManagerOutput', 'architectOutput', 'humanAnswers', 'alpha', 'zeta']);
  });
  it('lists every known key once', () => {
    expect(new Set(CONTEXT_ORDER).size).toBe(CONTEXT_ORDER.length);
  });
});

describe('shrinkValue', () => {
  const limits = { str: 10, arr: 2 };
  it('cuts long strings and long lists and says how much', () => {
    expect(shrinkValue('abcdefghijklmnop', limits)).toBe('abcdefghij... [6 characters cut]');
    expect(shrinkValue([1, 2, 3, 4], limits)).toEqual([1, 2, '[2 more items cut]']);
    expect(shrinkValue({ a: { b: ['x'.repeat(20), 1, 2] } }, limits)).toEqual({ a: { b: ['xxxxxxxxxx... [10 characters cut]', 1, '[1 more items cut]'] } });
  });
  it('leaves short values and scalars alone, and stops at a depth limit', () => {
    expect(shrinkValue({ a: 'short', b: [1], c: null, d: 7, e: true }, limits)).toEqual({ a: 'short', b: [1], c: null, d: 7, e: true });
    let deep: unknown = 'x';
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(JSON.stringify(shrinkValue(deep, limits))).toContain('[too deep]');
  });
});

describe('packContext', () => {
  it('only orders the input when it fits or there is no cap', () => {
    const input = { allArtifacts: [{ content: big(50) }], brief: 'b' };
    for (const cap of [null, 100000]) {
      const { context, meta } = packContext(input, cap);
      expect(Object.keys(context)).toEqual(['brief', 'allArtifacts']);
      expect(context.allArtifacts).toEqual(input.allArtifacts);
      expect(meta).toMatchObject({ trimmed: [], overBudget: false });
    }
  });

  it('shortens what may be shortened until it fits, and records what it cut', () => {
    const input = { brief: 'Build a thing', architectOutput: { spec: big(3000) }, allArtifacts: [{ phase: 'a', content: { text: big(3000) } }] };
    const before = estimateTokens(JSON.stringify(input));
    const { context, meta } = packContext(input, 2000);
    expect(before).toBeGreaterThan(2000);
    expect(meta.overBudget).toBe(false);
    expect(meta.estimatedTokens).toBeLessThanOrEqual(2000);
    expect(meta.trimmed.map(t => t.key).sort()).toEqual(['allArtifacts', 'architectOutput']);
    expect(meta.trimmed.every(t => t.afterTokens < t.beforeTokens)).toBe(true);
    expect(context.brief).toBe('Build a thing');
    expect(JSON.stringify(context)).toContain('characters cut');
  });

  it('stops at the gentlest step that fits', () => {
    const input = { architectOutput: { spec: 'x'.repeat(10000) } };
    const { context } = packContext(input, 1500);
    const spec = (context.architectOutput as { spec: string }).spec;
    expect(spec.startsWith('x'.repeat(2000))).toBe(true);
    expect(spec).toContain('[8000 characters cut]');
  });

  it('never shortens the task, a person\'s answers or the plan check, and reports when that is not enough', () => {
    const input = { brief: big(4000), humanAnswers: [{ question: 'q', answer: big(500) }], planCheck: { deviations: { missing: [], unplanned: [] } }, allArtifacts: [{ content: big(2000) }] };
    const { context, meta } = packContext(input, 1000);
    expect(context.brief).toBe(input.brief);
    expect(context.humanAnswers).toEqual(input.humanAnswers);
    expect(context.planCheck).toEqual(input.planCheck);
    expect(meta.overBudget).toBe(true);
    expect(describePack('reviewer', meta)).toContain('over the cap');
  });

  it('describes nothing when nothing was cut', () => {
    expect(describePack('analyzer', packContext({ brief: 'b' }, 1000).meta)).toBeNull();
    const cut = packContext({ architectOutput: { s: big(5000) } }, 800).meta;
    expect(describePack('analyzer', cut)).toMatch(/^Input for analyzer was shortened to fit its 800 token cap \(architectOutput \d+ to \d+\)$/);
  });
});

describe('compactArtifacts', () => {
  it('keeps the newest of each phase and type, drops timestamps, and keeps order of arrival', () => {
    const out = compactArtifacts([
      { phase: 'analyzer', type: 'a', content: { v: 1 }, timestamp: 't1' } as any,
      { phase: 'architect', type: 'a', content: { v: 2 } },
      { phase: 'analyzer', type: 'a', content: { v: 3 }, timestamp: 't2' } as any,
      { phase: 'analyzer', type: 'b' }
    ]);
    expect(out).toEqual([
      { phase: 'architect', type: 'a', content: { v: 2 } },
      { phase: 'analyzer', type: 'a', content: { v: 3 } },
      { phase: 'analyzer', type: 'b' }
    ]);
    expect(JSON.stringify(out)).not.toContain('timestamp');
  });
});

describe('the orchestrator uses the pack', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  beforeEach(() => { process.env.FACTORY_IGNORE_WIP = '1'; });
  afterEach(() => { delete process.env.FACTORY_IGNORE_WIP; });

  it('hands every agent its input in the fixed order, the same for agents that share inputs', async () => {
    const seen: Record<string, string[]> = {};
    const invoker = (async (_s: any, agent: string, input: Record<string, unknown>) => {
      seen[agent] = Object.keys(input);
      return { phase: agent, valid: true, ...stubPayload(agent), usage };
    }) as any;
    await new FactoryOrchestrator(invoker, false, undefined, retryConfig).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(seen['backend-engineer']).toEqual(['productManagerOutput', 'analyzerOutput', 'architectOutput']);
    expect(seen['backend-engineer']).toEqual(seen['frontend-engineer']);
    expect(seen['backend-engineer']).toEqual(seen['infrastructure-engineer']);
    expect(seen['software-architect']).toEqual(['brief', 'productManagerOutput', 'analyzerOutput']);
    expect(seen['reviewer']).toEqual(['allArtifacts', 'planCheck']);
  });

  it('notes in the workflow when an input had to be shortened', async () => {
    const huge = 'word '.repeat(60000);
    const invoker = (async (_s: any, agent: string) => ({
      phase: agent, valid: true, ...stubPayload(agent), ...(agent === 'analyzer' ? { analysis: { text: huge } } : {}), usage
    })) as any;
    const state = await new FactoryOrchestrator(invoker, false, undefined, retryConfig).executeWorkflow('Build', 1, {}, undefined, { until: 'software-architect' });
    expect(state.notes.some(n => /Input for software-architect was shortened to fit its 12000 token cap/.test(n))).toBe(true);
  });
});
