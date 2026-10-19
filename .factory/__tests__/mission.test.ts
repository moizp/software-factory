import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stubPayload, validateContract } from '../contracts';
import {
  Mission, alignmentProblems, loadMission, missionFile, missionForAgents, missionIds, parseMission, renderMissionLine, requireMission, unknownServes
} from '../mission';
import { FactoryOrchestrator } from '../orchestrator';
import { parsePlan, renderPlanSummary } from '../plan';
import { readEvents, replay, stateDifferences } from '../events';
import { readSnapshot } from '../state';
import { retryConfig } from './fixtures';

const root = path.join(__dirname, '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'mission.md'), 'utf-8');
const exampleMd = /```markdown\n([\s\S]*?)```/.exec(skill)![1];

const ok = (md: string): Mission => {
  const r = parseMission(md);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.mission;
};
const errorsOf = (md: string): string[] => {
  const r = parseMission(md);
  return r.ok ? [] : r.errors;
};

/** The example from the skill with one thing changed. */
const edit = (from: string | RegExp, to: string): string => exampleMd.replace(from, to);

describe('parseMission', () => {
  it('reads the example in the skill', () => {
    const r = parseMission(exampleMd);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mission.mission).toContain('Independent freelancers');
      expect(r.mission.users).toHaveLength(1);
      expect(r.mission.behaviourChanges.map(c => c.id)).toEqual(['BC1', 'BC2']);
      expect(r.mission.behaviourChanges[0]).toMatchObject({ name: 'Invoice at the moment of delivery', who: 'freelancers with fewer than ten clients' });
      expect(r.mission.notOurMission).toHaveLength(2);
      expect(r.warnings).toEqual([]);
    }
  });

  it('turns away the template until it is filled in', () => {
    const template = fs.readFileSync(path.join(root, 'templates', 'project', 'MISSION.md'), 'utf-8');
    expect(errorsOf(template)).toEqual(['the file still contains template placeholders (<...>, TODO or TBD)']);
    expect(errorsOf(edit('Independent freelancers get paid on time', 'TODO write the mission, TBD'))).toEqual([expect.stringContaining('placeholders')]);
  });

  it('names what is missing', () => {
    expect(errorsOf('# Something else')).toEqual(expect.arrayContaining([
      'there is no "# Mission" section', expect.stringContaining('"## Users"'), 'there is no "## Behaviour changes" section'
    ]));
    expect(errorsOf(edit(/Independent freelancers get paid on time without spending their evenings on admin\./, 'Short.'))).toEqual([expect.stringContaining('too short')]);
    expect(errorsOf(edit(/Independent freelancers get paid on time without spending their evenings on admin\./, 'word '.repeat(150)))).toEqual([expect.stringContaining('longer than 600')]);
    expect(errorsOf(edit(/- Freelancers and very small agencies:.*\n/, ''))).toEqual([expect.stringContaining('at least one group of users')]);
  });

  it('checks every behaviour change', () => {
    expect(errorsOf(edit(/- Signal: share of invoices[^\n]*\n/, ''))).toEqual(['BC1 has no "Signal:" line']);
    expect(errorsOf(edit('- Who: freelancers with fewer than ten clients', '- Who: all'))).toEqual([expect.stringContaining('BC1 "who" is too short')]);
    expect(errorsOf(edit('### BC2: Stop chasing by hand', '### Stop chasing by hand'))).toEqual([expect.stringContaining('must look like "### BC1: Short name"')]);
    expect(errorsOf(edit('### BC2:', '### BC1:'))).toEqual(['BC1 appears twice']);
    expect(errorsOf(edit(/- To: they send the invoice the same day they deliver the work/, '- To: they batch invoices at month end, often days late'))).toEqual([expect.stringContaining('"from" and "to" are the same')]);
    expect(errorsOf(edit(/- Who: freelancers with fewer than ten clients\n.*\n.*\n.*\n/, '- Who: freelancers with few clients\n'))).toEqual(expect.arrayContaining(['BC1 has no "From:" line', 'BC1 has no "To:" line']));
  });

  it('caps the number of behaviour changes and needs one', () => {
    const many = Array.from({ length: 9 }, (_, i) => `### BC${i + 1}: Change number ${i}\n- Who: some users\n- From: they do it the old way\n- To: they do it the new way ${i}\n- Signal: ${i + 1} per week\n`).join('\n');
    const md = `# Mission\n\nHelp our users do something better every single week.\n\n## Users\n\n- Everyone: they exist\n\n## Behaviour changes\n\n${many}\n## Not our mission\n\n- Other things\n`;
    expect(errorsOf(md)).toEqual(['more than 8 behaviour changes: a mission this wide cannot steer anything']);
    expect(errorsOf(md.replace(/### BC[\s\S]*## Not/, '## Not'))).toEqual(['"## Behaviour changes" must contain at least one "### BC1: ..." block']);
  });

  it('advises, without refusing, on work verbs, signals nobody can count and missing limits', () => {
    const r = parseMission(
      edit('- To: they send the invoice the same day they deliver the work', '- To: build an invoice reminder for them to use')
        .replace(/- Signal: share of invoices[^\n]*/, '- Signal: people feel better about it')
        .replace(/## Not our mission[\s\S]*$/, '')
    );
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([
      expect.stringContaining('BC1 "to" starts with a verb for work ("build")'),
      expect.stringContaining('BC1 "signal" names nothing countable'),
      expect.stringContaining('"## Not our mission" is empty')
    ]);
  });

  it('ignores headings inside code blocks and text inside HTML comments, and accepts other spellings', () => {
    const md = `<!-- ## Behaviour changes in a comment -->\n# Mission\n\nHelp our users do something better every single week.\n\n## Users\n\n* Everyone: they exist\n\n## Behavior Changes\n\n### BC1 - Be on time\n- who: some users\n- FROM: they arrive late today\n- To: they arrive on time\n- Signal: 80% on time\n\n\`\`\`\n## Not our mission\n\`\`\`\n\n## Non-goals\n\n- Scheduling the whole company\n`;
    const m = ok(md);
    expect(m.behaviourChanges.map(c => [c.id, c.name])).toEqual([['BC1', 'Be on time']]);
    expect(m.notOurMission).toEqual(['Scheduling the whole company']);
  });
});

describe('what agents receive', () => {
  const m = ok(exampleMd);
  it('is short keys and nothing else', () => {
    const v = missionForAgents(m) as any;
    expect(Object.keys(v)).toEqual(['mission', 'users', 'behaviour_changes', 'not_our_mission']);
    expect(v.behaviour_changes[0]).toEqual({ id: 'BC1', name: 'Invoice at the moment of delivery', who: expect.any(String), from: expect.any(String), to: expect.any(String), signal: expect.any(String) });
    expect(missionIds(m)).toEqual(['BC1', 'BC2']);
    expect(renderMissionLine(m)).toMatch(/\(BC1, BC2\)$/);
    expect(unknownServes(m, ['BC1', 'BC9'])).toEqual(['BC9']);
  });
});

describe('loading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-'));
  it('finds the file by default name or environment, and only requires it when asked', () => {
    expect(missionFile('/p', {})).toBe('/p/MISSION.md');
    expect(missionFile('/p', { FACTORY_MISSION_FILE: 'docs/m.md' })).toBe('/p/docs/m.md');
    expect(requireMission({})).toBe(false);
    expect(requireMission({ FACTORY_REQUIRE_MISSION: '1' })).toBe(true);
    expect(requireMission({ FACTORY_REQUIRE_MISSION: 'TRUE' })).toBe(true);
    expect(requireMission({ FACTORY_REQUIRE_MISSION: 'no' })).toBe(false);
    expect(loadMission(path.join(dir, 'nope.md'))).toEqual({ found: false });
    const file = path.join(dir, 'MISSION.md');
    fs.writeFileSync(file, exampleMd);
    expect(loadMission(file)).toMatchObject({ found: true, result: { ok: true } });
  });

  it('the check command reads a file, says what is wrong and exits accordingly', () => {
    const good = path.join(dir, 'good.md');
    const bad = path.join(dir, 'bad.md');
    fs.writeFileSync(good, exampleMd);
    fs.writeFileSync(bad, '# Mission\n');
    const run = (...a: string[]) => spawnSync('npx', ['ts-node', '.factory/mission-cli.ts', ...a], { cwd: root, encoding: 'utf-8' });
    const g = run(good);
    expect(g.status).toBe(0);
    expect(g.stdout).toContain('2 behaviour change(s)');
    expect(JSON.parse(run(good, '--json').stdout).behaviour_changes).toHaveLength(2);
    const b = run(bad);
    expect(b.status).toBe(1);
    expect(b.stderr).toContain('cannot be used');
    expect(run(path.join(dir, 'missing.md')).status).toBe(1);
  });
});

describe('alignmentProblems', () => {
  const m = ok(exampleMd);
  const good = () => ({
    features: { must_have: [{ name: 'Send invoice', serves: ['BC1'] }], nice_to_have: [{ name: 'Reminders', serves: ['BC2'] }] },
    mission_alignment: { behaviour_changes_covered: ['BC1', 'BC2'], behaviour_changes_not_covered: [], out_of_mission: [] }
  });
  it('accepts a complete answer', () => expect(alignmentProblems(m, good())).toEqual([]));
  it('asks for the section when it is missing', () => {
    expect(alignmentProblems(m, { features: {} })[0]).toContain('mission_alignment is missing');
  });
  it('wants every feature tied to the mission or listed as out of it', () => {
    const r = good() as any;
    r.features.nice_to_have.push({ name: 'Dark mode' });
    expect(alignmentProblems(m, r)).toEqual([expect.stringContaining('feature "Dark mode" has no "serves"')]);
    r.mission_alignment.out_of_mission.push({ feature: 'Dark mode', reason: 'Moves nothing' });
    expect(alignmentProblems(m, r)).toEqual([]);
  });
  it('does not let a must-have be out of mission', () => {
    const r = good() as any;
    r.mission_alignment.out_of_mission.push({ feature: 'Send invoice', reason: 'nah' });
    expect(alignmentProblems(m, r)[0]).toContain('must-have feature "Send invoice" is listed as out of mission');
  });
  it('rejects ids the mission does not have, and malformed entries', () => {
    const r = good() as any;
    r.features.must_have[0].serves = ['BC1', 'BC7'];
    r.mission_alignment.behaviour_changes_covered = ['BC9'];
    r.mission_alignment.out_of_mission = [{ feature: 'x' }];
    expect(alignmentProblems(m, r)).toEqual(expect.arrayContaining([
      expect.stringContaining('serves "BC7"'), expect.stringContaining('names BC9'), 'each out_of_mission entry needs "feature" and "reason"'
    ]));
    expect(alignmentProblems(m, { ...good(), mission_alignment: { behaviour_changes_covered: 'BC1', behaviour_changes_not_covered: [], out_of_mission: 5 } })).toEqual(
      expect.arrayContaining([expect.stringContaining('must be a list of behaviour change ids'), expect.stringContaining('out_of_mission must be a list')]));
  });
});

describe('plans and the mission', () => {
  const m = ok(exampleMd);
  const phase = (over: Record<string, unknown> = {}) => ({ name: 'Send', files: ['src/a.ts'], automated_checks: ['npm test'], serves: ['BC1'], ...over });
  it('keeps serves, defaults it to none, and refuses ids the mission lacks', () => {
    const r = parsePlan({ phases: [phase(), phase({ name: 'Groundwork', serves: undefined })] }, { mission: m });
    expect(r.ok && r.plan.phases.map(p => p.serves)).toEqual([['BC1'], []]);
    expect((parsePlan({ phases: [phase({ serves: ['BC1', 'BC5'] })] }, { mission: m }) as any).error).toContain('BC5, which is not in the mission (BC1, BC2)');
    expect(parsePlan({ phases: [phase({ serves: ['BC5'] })] }).ok).toBe(true);
    expect(parsePlan({ phases: [phase({ serves: 'BC1' })] }).ok).toBe(false);
  });
  it('the summary says what each phase serves and what the plan leaves out', () => {
    const plan = (parsePlan({ phases: [phase()] }, { mission: m }) as any).plan;
    const md = renderPlanSummary(plan, 6000, m);
    expect(md).toContain('Serves: BC1');
    expect(md).toContain('Mission: not served by this plan: BC2');
    expect(renderPlanSummary(plan)).not.toContain('Mission:');
    const both = (parsePlan({ phases: [phase(), phase({ name: 'Two', serves: ['BC2'] })] }, { mission: m }) as any).plan;
    expect(renderPlanSummary(both, 6000, m)).toContain('every behaviour change is served');
  });
});

describe('the contract with a mission', () => {
  const m = ok(exampleMd);
  const pm = (extra: Record<string, unknown> = {}) => ({ phase: 'product-manager', valid: true, ...stubPayload('product-manager'), features: { must_have: [{ name: 'F', serves: ['BC1'] }] }, ...extra });
  it('does nothing without a mission', () => {
    expect(validateContract(pm(), 'product-manager')).toEqual([]);
  });
  it('asks the product manager for its alignment when there is one', () => {
    expect(validateContract(pm(), 'product-manager', { mission: m })[0]).toContain('mission_alignment is missing');
    const aligned = pm({ mission_alignment: { behaviour_changes_covered: ['BC1'], behaviour_changes_not_covered: ['BC2'], out_of_mission: [] } });
    expect(validateContract(aligned, 'product-manager', { mission: m })).toEqual([]);
  });
  it('does not hold a declined reply to it', () => {
    expect(validateContract({ phase: 'product-manager', valid: false, error: 'no', blockers: [{ a: 1 }] }, 'product-manager', { mission: m })).toEqual([]);
  });
  it('checks the architect\'s plan against the mission ids', () => {
    const arch = (serves: string[]) => ({ phase: 'software-architect', valid: true, ...stubPayload('software-architect'), implementation_plan: { phases: [{ name: 'A', files: ['a.ts'], automated_checks: ['npm test'], serves }] } });
    expect(validateContract(arch(['BC1']), 'software-architect', { mission: m })).toEqual([]);
    expect(validateContract(arch(['BC4']), 'software-architect', { mission: m })[0]).toContain('BC4');
  });
});

describe('the documents', () => {
  it('the commands and the skill point at real things', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).scripts;
    expect(scripts['mission:check']).toBeDefined();
    expect(fs.readFileSync(path.join(root, '.claude', 'commands', 'mission.md'), 'utf-8')).toContain('npm run mission:check');
    expect(fs.readFileSync(path.join(root, '.claude', 'commands', 'mission-check.md'), 'utf-8')).toContain('Not our mission');
    for (const word of ['MISSION.md', 'FACTORY_REQUIRE_MISSION', 'product-manager', 'one-off exception', 'protected path']) expect(skill).toContain(word);
  });
  it('MISSION.md needs a person to merge it', () => {
    const policy = JSON.parse(fs.readFileSync(path.join(root, '.factory', 'policy.json'), 'utf-8'));
    expect(policy.protected_paths).toContain('MISSION.md');
  });
});

// ---- whole workflows -------------------------------------------------------------------------------------------------

describe('the orchestrator with a mission', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-orch-'));
  const missionPath = path.join(dir, 'MISSION.md');
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['FACTORY_MISSION_FILE', 'FACTORY_REQUIRE_MISSION', 'FACTORY_DATA_DIR', 'FACTORY_IGNORE_WIP', 'FACTORY_PLAN_APPROVAL']) saved[k] = process.env[k];
    process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(dir, 'data-'));
    process.env.FACTORY_IGNORE_WIP = '1';
    process.env.FACTORY_MISSION_FILE = missionPath;
    delete process.env.FACTORY_REQUIRE_MISSION;
    fs.writeFileSync(missionPath, exampleMd);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const aligned = { mission_alignment: { behaviour_changes_covered: ['BC1'], behaviour_changes_not_covered: ['BC2'], out_of_mission: [] } };
  function recorder(over: Record<string, (n: number) => Record<string, unknown>> = {}) {
    const calls: Array<{ agent: string; input: Record<string, any> }> = [];
    const invoker = (async (_s: any, agent: string, input: Record<string, any>) => {
      calls.push({ agent, input });
      const n = calls.filter(c => c.agent === agent).length;
      const base = { phase: agent, valid: true, ...stubPayload(agent), usage };
      if (agent === 'product-manager') return { ...base, features: { must_have: [{ name: 'F', serves: ['BC1'] }] }, ...aligned, ...(over[agent]?.(n) ?? {}) };
      return { ...base, ...(over[agent]?.(n) ?? {}) };
    }) as any;
    return { invoker, calls, of: (a: string) => calls.filter(c => c.agent === a) };
  }
  const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);

  it('reads the mission into the workflow and hands it to the agents that plan and judge', async () => {
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(state.mission!.behaviourChanges.map(c => c.id)).toEqual(['BC1', 'BC2']);
    expect(state.notes.some(n => n.includes('Mission loaded:') && n.includes('(BC1, BC2)'))).toBe(true);
    for (const agent of ['product-manager', 'analyzer', 'software-architect', 'reviewer']) {
      expect(r.of(agent)[0].input.mission.behaviour_changes.map((c: any) => c.id)).toEqual(['BC1', 'BC2']);
    }
    for (const agent of ['backend-engineer', 'frontend-engineer', 'infrastructure-engineer', 'automation-tester', 'e2e-tester']) {
      expect(r.of(agent)[0].input.mission).toBeUndefined();
    }
    expect(Object.keys(r.of('product-manager')[0].input)).toEqual(['brief', 'mission']);
  });

  it('asks the product manager again when it ignores the mission', async () => {
    const r = recorder({ 'product-manager': n => (n === 1 ? { mission_alignment: undefined } : {}) });
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'product-manager' });
    expect(r.of('product-manager')).toHaveLength(2);
    expect(r.of('product-manager')[1].input.repair.problem).toContain('mission_alignment is missing');
    expect(state.phases.find(p => p.phase === 'product-manager')!.valid).toBe(true);
  });

  it('fails a product manager that keeps ignoring it, and says why', async () => {
    const r = recorder({ 'product-manager': () => ({ mission_alignment: undefined }) });
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'product-manager' });
    expect(state.status).toBe('failed');
    expect(state.phases[0].error).toContain('mission_alignment is missing');
  });

  it('puts which behaviour changes the plan serves in front of the person approving it', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    const r = recorder({ 'software-architect': () => ({ implementation_plan: { phases: [{ name: 'Send', files: ['a.ts'], automated_checks: ['npm test'], serves: ['BC1'] }] } }) });
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    const ctx = state.humanRequests![0].request.context!;
    expect(ctx).toContain('Serves: BC1');
    expect(ctx).toContain('Mission: not served by this plan: BC2');
  });

  it('stops on a mission file it cannot use, with the reasons', async () => {
    fs.writeFileSync(missionPath, '# Mission\n\nShort.\n');
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(state.status).toBe('failed');
    expect(r.calls).toHaveLength(0);
    expect(state.notes.some(n => n.includes('is not usable') && n.includes('too short'))).toBe(true);
  });

  it('carries on without a mission file unless one is required', async () => {
    fs.rmSync(missionPath);
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(state.status).toBe('paused');
    expect(state.mission).toBeUndefined();
    expect(state.notes.some(n => n.includes('No mission file') && n.includes('not checked against a mission'))).toBe(true);
    expect(r.of('product-manager')[0].input.mission).toBeUndefined();

    process.env.FACTORY_REQUIRE_MISSION = '1';
    const r2 = recorder();
    const required = await orch(r2.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'analyzer' });
    expect(required.status).toBe('failed');
    expect(required.notes.some(n => n.includes('FACTORY_REQUIRE_MISSION is on'))).toBe(true);
    expect(r2.calls).toHaveLength(0);
  });

  it('a resumed workflow keeps the mission it started with', async () => {
    const r = recorder();
    const o = orch(r.invoker);
    const stopped = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    fs.writeFileSync(missionPath, exampleMd.replace('BC2: Stop chasing by hand', 'BC2: Something else entirely'));
    await o.executeWorkflow('Build', 1, {}, stopped, { until: 'software-architect' });
    expect(r.of('software-architect')[0].input.mission.behaviour_changes[1].name).toBe('Stop chasing by hand');
  });

  it('the event log replays to a state that has a mission', async () => {
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'software-architect' });
    expect(stateDifferences(replay(readEvents(state.id).events)!, readSnapshot(state.id)!)).toEqual([]);
    expect(readSnapshot(state.id)!.mission!.mission).toContain('Independent freelancers');
  });
});
