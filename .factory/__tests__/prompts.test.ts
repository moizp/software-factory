import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { AGENT_NAMES, agentFilePath } from '../pipeline';
import {
  estimateTokens, loadBudgets, measurePrompts, outputExample, renderPromptReport, renderUsageReport, usageByAgent
} from '../prompts';

const root = path.join(__dirname, '..', '..');
const usage = (total: number, input: number, output: number, cacheRead = 0, cacheCreation = 0) =>
  ({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation, totalTokens: total, costUsd: 0, turns: 1 });

describe('the prompt budgets', () => {
  const budgets = loadBudgets();

  it('cover exactly the registered agents', () => {
    expect(Object.keys(budgets).sort()).toEqual([...AGENT_NAMES].sort());
    for (const b of Object.values(budgets)) {
      expect(b.instructions).toBeGreaterThan(500);
      expect(b.context).toBeGreaterThan(1000);
    }
  });

  it.each(AGENT_NAMES)('%s stays within its prompt budget', agent => {
    const tokens = estimateTokens(fs.readFileSync(agentFilePath(agent), 'utf-8'));
    expect({ agent, tokens, within: tokens <= budgets[agent].instructions }).toEqual({ agent, tokens, within: true });
  });

  it('have headroom, so a small edit does not need a budget change', () => {
    for (const row of measurePrompts()) expect(row.budget / row.tokens).toBeGreaterThan(1.05);
  });
});

describe('sample replies in the prompts', () => {
  const walk = (v: unknown, where: string, problems: string[]): void => {
    if (Array.isArray(v)) {
      const nested = v.some(x => x && typeof x === 'object');
      if (v.length > (nested ? 1 : 2)) problems.push(`${where} has ${v.length} items`);
      v.forEach((x, i) => walk(x, `${where}[${i}]`, problems));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`, problems);
    }
  };

  it.each(AGENT_NAMES)('%s shows the shape once: one object per list, two plain values at most', agent => {
    const example = outputExample(fs.readFileSync(agentFilePath(agent), 'utf-8'));
    expect(example).not.toBeNull();
    const problems: string[] = [];
    walk(JSON.parse(example!), 'reply', problems);
    expect(problems).toEqual([]);
  });

  it('outputExample finds the first json block after the heading', () => {
    expect(outputExample('x\n```json\n{"a":1}\n```\n## Output Format\ntext\n```json\n{"b":2}\n```\n```json\n{"c":3}\n```')).toBe('{"b":2}');
    expect(outputExample('no heading')).toBeNull();
    expect(outputExample('## Output Format\nno block')).toBeNull();
  });
});

describe('measurePrompts and the report', () => {
  const fake = { 'product-manager': 'x'.repeat(400) };
  const rows = measurePrompts({ 'product-manager': { instructions: 90, context: 5000 } }, a => fake[a as 'product-manager'] ?? 'y'.repeat(40));

  it('measures size and flags a prompt over its budget', () => {
    expect(rows.find(r => r.agent === 'product-manager')).toMatchObject({ tokens: 100, budget: 90, over: true });
    expect(rows.find(r => r.agent === 'analyzer')).toMatchObject({ tokens: 10, budget: 0, over: true });
  });
  it('renders a table with the total', () => {
    const md = renderPromptReport(rows);
    expect(md).toContain('product-manager');
    expect(md).toContain('OVER');
    expect(md).toContain(`Total ${rows.reduce((s, r) => s + r.tokens, 0)} tokens across 10 agents`);
  });
  it('the CLI report passes for the committed prompts and exits 2 on a bad command', () => {
    const run = (...a: string[]) => spawnSync('npx', ['ts-node', '.factory/report-cli.ts', ...a], { cwd: root, encoding: 'utf-8' });
    const ok = run('prompts');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('customer-support');
    expect(run('nope').status).toBe(2);
  });
});

describe('usageByAgent', () => {
  const gate = (phase: string, u?: ReturnType<typeof usage>) => ({ phase, valid: true, timestamp: '', ...(u ? { usage: u } : {}) });
  const states = [
    { phases: [gate('analyzer', usage(1000, 600, 400, 0, 0)), gate('architect-less'), gate('software-architect', usage(5000, 1000, 2000, 1500, 500))] },
    { phases: [gate('analyzer', usage(3000, 800, 200, 1200, 800))] }
  ] as any;

  it('adds up calls, averages and the share served from the cache', () => {
    const rows = usageByAgent(states);
    expect(rows.map(r => r.agent)).toEqual(['software-architect', 'analyzer']);
    const analyzer = rows.find(r => r.agent === 'analyzer')!;
    expect(analyzer).toMatchObject({ calls: 2, avgTotal: 2000, avgOutput: 300, totalTokens: 4000 });
    expect(analyzer.avgInput).toBe(1700);
    expect(analyzer.cacheShare).toBeCloseTo(1200 / 3400);
    expect(rows[0].cacheShare).toBeCloseTo(1500 / 3000);
  });
  it('skips gates without usage and says so when there is none', () => {
    expect(usageByAgent([{ phases: [gate('analyzer')] }] as any)).toEqual([]);
    expect(renderUsageReport([])).toContain('No usage recorded yet');
    expect(renderUsageReport(usageByAgent(states))).toContain('Cached input');
  });
});
