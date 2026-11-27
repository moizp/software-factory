import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { validateContract } from '../contracts';
import { FactoryOrchestrator } from '../orchestrator';
import { stubPayload } from '../contracts';
import { layoutCheckProblems, loadUiRules, parseUiRules, uiRulesForAgents } from '../uirules';
import { retryConfig } from './fixtures';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'uirules-'));

describe('UI rules file', () => {
  it('the factory default has the rules the owner stated and a six-item checklist', () => {
    const load = loadUiRules(tmp());
    if ('error' in load) throw new Error(load.error);
    expect(load.rules.source).toBe('factory');
    const text = load.rules.rules.map(r => r.text).join('\n');
    for (const stated of [/6 px between neighbouring controls/, /8 px between a label or counter and a bordered control/, /own horizontal padding/, /reserved minimum width/, /focus ring stays/, /44 px/]) expect(text).toMatch(stated);
    expect(load.rules.checklist).toHaveLength(6);
  });
  it('a project file replaces the default; an unusable one is reported, not guessed', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'UI-RULES.md'), '- R1: Keep 6 px between controls.\n- R2: Own padding.\n\n## Checklist\n1. Run the guard.\n');
    const load = loadUiRules(d);
    if ('error' in load) throw new Error(load.error);
    expect(load.rules).toMatchObject({ source: 'project', rules: [{ id: 'R1' }, { id: 'R2' }], checklist: ['Run the guard.'] });
    expect(uiRulesForAgents(load.rules)).toEqual({ rules: ['R1: Keep 6 px between controls.', 'R2: Own padding.'], checklist: ['Run the guard.'] });
    fs.writeFileSync(path.join(d, 'UI-RULES.md'), 'no rules here');
    expect(loadUiRules(d)).toHaveProperty('error');
    expect(parseUiRules('- R1: a\n- R1: b')).toMatchObject({ ok: false });
  });
});

describe('layout_check', () => {
  const good = { rows: ['reader controls'], worst_case: '4 digit page numbers and the longest label', spacing: 'gap-2 on the row, px-2 on the counter', limits_changed: false };
  it('is required of the frontend engineer when UI rules are in force, and only then', () => {
    const base = { phase: 'frontend-engineer', valid: true, ...stubPayload('frontend-engineer') };
    delete (base as any).layout_check;
    expect(validateContract(base, 'frontend-engineer', {}).filter(e => /layout_check/.test(e))).toEqual([]);
    expect(validateContract(base, 'frontend-engineer', { uiRules: true }).join(' ')).toMatch(/layout_check is missing/);
    expect(validateContract({ ...base, layout_check: good }, 'frontend-engineer', { uiRules: true })).toEqual([]);
  });
  it('wants worst case and spacing when rows were added, and limits_changed false always', () => {
    expect(layoutCheckProblems({ layout_check: { rows: [], limits_changed: false } })).toEqual([]);
    expect(layoutCheckProblems({ layout_check: { ...good, worst_case: '', spacing: '' } })).toHaveLength(2);
    expect(layoutCheckProblems({ layout_check: { ...good, limits_changed: true } })[0]).toMatch(/never lowered/);
    expect(layoutCheckProblems({ layout_check: { ...good, limits_changed: undefined } })).toHaveLength(1);
    expect(layoutCheckProblems({})[0]).toMatch(/layout_check is missing/);
  });
});

describe('the orchestrator hands the rules over', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  beforeEach(() => { process.env.FACTORY_IGNORE_WIP = '1'; process.env.FACTORY_DATA_DIR = tmp(); });
  afterEach(() => { delete process.env.FACTORY_IGNORE_WIP; delete process.env.FACTORY_DATA_DIR; });
  it('to the frontend engineer, e2e tester and reviewer only, and asks again when layout_check is wrong', async () => {
    const seen: Record<string, boolean> = {};
    let bad = true;
    const invoker = (async (_s: any, agent: string, input: Record<string, unknown>) => {
      seen[agent] = 'ui_rules' in input;
      const payload: Record<string, unknown> = stubPayload(agent);
      if (agent === 'frontend-engineer' && bad) { bad = false; payload.layout_check = { rows: ['r'], limits_changed: true }; }
      return { phase: agent, valid: true, ...payload, usage };
    }) as any;
    const state = await new FactoryOrchestrator(invoker, false, undefined, retryConfig).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(Object.keys(seen).filter(a => seen[a]).sort()).toEqual(['e2e-tester', 'frontend-engineer', 'reviewer']);
    expect(state.uiRules?.source).toBe('factory');
    expect(state.notes.join(' ')).toMatch(/UI rules loaded \(factory\): 11 rules, 6 checklist items/);
    expect(bad).toBe(false);
    expect(state.phases.find(p => p.phase === 'frontend-engineer')?.valid).toBe(true);
  });
});
