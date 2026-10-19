import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stubPayload, validateContract } from '../contracts';
import {
  Character, characterConformanceProblems, characterForAgents, loadCharacter, parseCharacter, parseTrait, parseValue, renderCharacterLine
} from '../character';
import { ARCHETYPES, findArchetype, shortlistArchetypes } from '../character-catalogue';
import { FEELS } from '../lookfeel-catalogue';
import { parseMission } from '../mission';
import { FactoryOrchestrator } from '../orchestrator';
import { retryConfig } from './fixtures';

const root = path.join(__dirname, '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'character.md'), 'utf-8');
const missionSkill = fs.readFileSync(path.join(root, '.claude', 'skills', 'mission.md'), 'utf-8');
const charMd = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
const missionMd = /```markdown\n([\s\S]*?)```/.exec(missionSkill)![1];
const mp = parseMission(missionMd);
if (!mp.ok) throw new Error('the mission skill example must parse');
const mission = mp.mission;

const errorsOf = (md: string, m = mission): string[] => {
  const r = parseCharacter(md, m);
  return r.ok ? [] : r.errors;
};
const ok = (md: string, m = mission): Character => {
  const r = parseCharacter(md, m);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.character;
};
const edit = (from: string | RegExp, to: string): string => charMd.replace(from, to);

describe('the archetype catalogue', () => {
  it('has the twelve archetypes, each described in every field', () => {
    expect(ARCHETYPES.map(a => a.name)).toEqual(['Innocent', 'Sage', 'Explorer', 'Outlaw', 'Magician', 'Hero', 'Lover', 'Jester', 'Everyman', 'Caregiver', 'Ruler', 'Creator']);
    for (const a of ARCHETYPES) {
      for (const k of ['essence', 'acts', 'speaks', 'promise', 'care'] as const) expect({ a: a.name, k, ok: a[k].trim().length >= 12 }).toEqual({ a: a.name, k, ok: true });
      expect(a.feel.length).toBeGreaterThanOrEqual(2);
      expect(a.feel.every(f => FEELS.includes(f))).toBe(true);
    }
  });
  it('finds an archetype by name or alias, ignoring case and spacing', () => {
    expect(findArchetype('caregiver')?.name).toBe('Caregiver');
    expect(findArchetype('Regular Person')?.name).toBe('Everyman');
    expect(findArchetype('JOKER')?.name).toBe('Jester');
    expect(findArchetype('villain')).toBeUndefined();
    expect(findArchetype('')).toBeUndefined();
  });
  it('shortlists by shared feelings, best first, and returns nothing for no match', () => {
    const list = shortlistArchetypes(['warm', 'calm', 'trustworthy']);
    expect(list[0].matched).toEqual(['warm', 'calm', 'trustworthy']);
    expect(list.map(x => x.archetype.name)).toContain('Caregiver');
    expect(list.length).toBeLessThanOrEqual(4);
    expect(shortlistArchetypes([])).toEqual([]);
  });
});

describe('trait and value lines', () => {
  it('reads "trait, not opposite: how"', () => {
    expect(parseTrait('Calm, not cautious: states the next step')).toEqual({ is: 'Calm', isNot: 'cautious', shows: 'states the next step' });
    expect(parseTrait('Calm, not cautious')).toEqual({ is: 'Calm', isNot: 'cautious' });
    expect(parseTrait('Just friendly')).toBeNull();
  });
  it('reads "this over that: what it means"', () => {
    expect(parseValue('Clarity over cleverness: a plain sentence wins')).toEqual({ prefers: 'Clarity', over: 'cleverness', means: 'a plain sentence wins' });
    expect(parseValue('Clarity and cleverness')).toBeNull();
  });
});

describe('parseCharacter', () => {
  it('accepts the skill example and reads every layer', () => {
    const c = ok(charMd);
    expect(c.archetype).toMatchObject({ primary: 'Caregiver', secondary: 'Sage' });
    expect(c.traits).toHaveLength(3);
    expect(c.values).toHaveLength(2);
    expect(c.relationship.role).toContain('bookkeeper');
    expect(c.moments.ourFailure).toContain('Says so first');
    expect(c.moments.waiting).toContain('how long');
    expect(c.moments.leaving).toBeUndefined();
    expect(c.boundaries.humour).toContain('none');
    expect(renderCharacterLine(c)).toBe('Caregiver with Sage: Calm, Direct, Patient');
  });
  it('accepts it without a mission, and drops an empty secondary', () => {
    const c = ok(edit(/- Secondary:.*\n/, ''), undefined);
    expect(c.archetype.secondary).toBeUndefined();
  });
  it('requires every section and every required line', () => {
    expect(errorsOf(edit(/## Moments[\s\S]*?(?=## Boundaries)/, ''))).toContain('there is no "## Moments" section');
    expect(errorsOf(edit(/- Saying no:.*\n/, ''))).toContain('Moments has no "Saying no:" line');
    expect(errorsOf(edit(/- Humour:.*\n/, ''))).toContain('Boundaries has no "Humour:" line');
    expect(errorsOf(edit(/## Traits[\s\S]*?(?=## Values)/, ''))).toContain('there is no "## Traits" section');
  });
  it('rejects lines too short to decide anything, but accepts "none" for humour', () => {
    expect(errorsOf(edit(/- Stance:.*\n/, '- Stance: nice\n'))).toContain('Relationship "Stance" is too short to decide anything');
    expect(errorsOf(edit(/- Humour:.*\n/, '- Humour: none\n'))).toEqual([]);
    expect(errorsOf(edit(/- Humour:.*\n/, '- Humour: no\n'))).toContain('Boundaries "Humour" is too short to decide anything');
  });
  it('needs three to five traits and two to four values, in the right shape', () => {
    expect(errorsOf(edit(/- Patient, not passive:.*\n/, ''))).toContain('Traits needs 3 to 5 lines, found 2');
    expect(errorsOf(edit(/- Calm, not cautious/, '- Friendly and professional'))).toEqual(
      expect.arrayContaining([expect.stringContaining('Traits: "Friendly and professional')]));
    expect(errorsOf(edit(/- The person's time over our metrics:.*\n/, ''))).toContain('Values needs 2 to 4 lines, found 1');
  });
  it('checks the archetype against the catalogue and allows a custom one with advice', () => {
    expect(errorsOf(edit('Primary: Caregiver', 'Primary: Villain')).join()).toContain('"Villain" is not an archetype in the catalogue');
    const custom = parseCharacter(edit('Primary: Caregiver', 'Primary: Custom: Night Porter'), mission);
    expect(custom.ok).toBe(true);
    expect(custom.warnings.join()).toContain('"Night Porter" is not in the catalogue');
    expect(errorsOf(edit('Secondary: Sage', 'Secondary: Caregiver'))).toContain('Secondary is the same archetype as Primary');
  });
  it('holds the Why to the mission when there is one', () => {
    expect(errorsOf(edit(/- Why:.*\n/, '- Why: it feels friendly and suits everyone here\n')).join()).toContain('must tie the choice to the mission');
    expect(errorsOf(edit(/- Why: BC1/, '- Why: BC9')).join()).toContain('cites BC9, which the mission does not have');
    const noMission = parseCharacter(edit(/- Why:.*\n/, '- Why: it feels friendly and suits everyone here\n'));
    expect(noMission.ok).toBe(true);
  });
  it('warns, without failing, about thin boundaries, a humourless jester and a joke at failure', () => {
    const thin = parseCharacter(edit(/- Never:.*\n/, '- Never: blame the person\n'), mission);
    expect(thin.ok && thin.warnings.join()).toContain('"Never" lists fewer than two things');
    const jester = parseCharacter(edit('Primary: Caregiver', 'Primary: Jester').replace('- Secondary: Sage\n', ''), mission);
    expect(jester.ok && jester.warnings.join()).toContain('Primary is Jester but Humour is none');
    const joke = parseCharacter(edit(/- Humour:.*\n/, '- Humour: a dry line in empty states\n').replace(/Says so first/, 'Makes a joke, then says so'), mission);
    expect(joke.ok && joke.warnings.join()).toContain('"Our failure" uses humour');
  });
  it('rejects a file that still has template placeholders', () => {
    expect(errorsOf(edit(/- Role:.*\n/, '- Role: <what the product is to the person>\n'))).toContain('the file still contains template placeholders (<...>, TODO or TBD)');
  });
  it('ignores placeholders inside comments and code fences', () => {
    expect(errorsOf(`<!-- <fill me> -->\n${charMd}\n\n\`\`\`\n<example>\n\`\`\`\n`)).toEqual([]);
  });
});

describe('the shipped template', () => {
  const template = fs.readFileSync(path.join(root, 'templates', 'project', 'CHARACTER.md'), 'utf-8');
  it('is not usable until it is filled in, and says why', () => {
    const r = parseCharacter(template, mission);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join()).toContain('template placeholders');
  });
  it('has every section the parser reads', () => {
    for (const s of ['Archetype', 'Traits', 'Values', 'Relationship', 'Moments', 'Boundaries']) expect(template).toContain(`## ${s}`);
  });
});

describe('what agents receive', () => {
  it('has the declared layers and the archetype notes', () => {
    const view = characterForAgents(ok(charMd)) as any;
    expect(Object.keys(view)).toEqual(['archetype', 'traits', 'values', 'relationship', 'moments', 'boundaries', 'archetype_notes']);
    expect(view.archetype_notes.map((n: any) => n.archetype)).toEqual(['Caregiver', 'Sage']);
  });
  it('has no notes for a custom archetype', () => {
    const c = ok(edit('Primary: Caregiver', 'Primary: Custom: Night Porter').replace('- Secondary: Sage\n', ''));
    expect((characterForAgents(c) as any).archetype_notes).toBeUndefined();
  });
});

describe('characterConformanceProblems', () => {
  const good = { character_fit: { traits: 'Calm copy that states the next step', moments: 'Failure says so first, then what is safe', deviations: [] } };
  it('accepts a reply that says how it follows the character', () => {
    expect(characterConformanceProblems(good)).toEqual([]);
  });
  it('names what is missing', () => {
    expect(characterConformanceProblems({})[0]).toContain('character_fit is missing');
    expect(characterConformanceProblems({ character_fit: { traits: 'ok', moments: 'x', deviations: 'none' } })).toEqual([
      'character_fit.traits must say how the work follows the declared traits',
      'character_fit.moments must say how the work follows the declared moments',
      'character_fit.deviations must be a list (empty when the work departs from nothing)'
    ]);
  });
  it('is required of the frontend engineer only when the project has a character', () => {
    const reply = { phase: 'frontend-engineer', valid: true, ...stubPayload('frontend-engineer') };
    expect(validateContract(reply, 'frontend-engineer', {})).toEqual([]);
    expect(validateContract(reply, 'frontend-engineer', { character: ok(charMd) })[0]).toContain('character_fit is missing');
    expect(validateContract({ ...reply, ...good }, 'frontend-engineer', { character: ok(charMd) })).toEqual([]);
    expect(validateContract({ phase: 'reviewer', valid: true, ...stubPayload('reviewer') }, 'reviewer', { character: ok(charMd) })).toEqual([]);
  });
});

describe('the CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-cli-'));
  const cli = path.join(root, '.factory', 'character-cli.ts');
  const run = (args: string[], cwd = dir) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), cli, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, FACTORY_MISSION_FILE: path.join(dir, 'none.md') } });

  it('checks a file, and says what is wrong with a bad one', () => {
    const good = path.join(dir, 'good.md'); fs.writeFileSync(good, charMd);
    const bad = path.join(dir, 'bad.md'); fs.writeFileSync(bad, '# Character\n');
    const g = run(['check', good]);
    expect(g.status).toBe(0);
    expect(g.stdout).toContain('Caregiver with Sage');
    const b = run(['check', bad]);
    expect(b.status).toBe(1);
    expect(b.stderr).toContain('there is no "## Archetype" section');
    expect(run(['check', path.join(dir, 'missing.md')]).status).toBe(1);
  });
  it('lists, describes and shortlists', () => {
    expect(run(['catalogue']).stdout).toContain('Caregiver');
    expect(run(['catalogue', 'sage']).stdout).toContain('take care');
    expect(run(['catalogue', 'villain']).status).toBe(1);
    expect(run(['shortlist', 'warm,calm']).stdout).toContain('Caregiver');
    expect(run(['shortlist', 'sparkly']).status).toBe(2);
    expect(run(['nonsense']).status).toBe(2);
  });
});

describe('the repository', () => {
  it('protects CHARACTER.md in the merge policy and has the scripts', () => {
    const policy = JSON.parse(fs.readFileSync(path.join(root, '.factory', 'policy.json'), 'utf-8'));
    expect(policy.protected_paths).toContain('CHARACTER.md');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.scripts.character).toBeDefined();
    expect(pkg.scripts['character:check']).toBeDefined();
  });
  it('is gated by the look and feel skill, which says to decide the character first', () => {
    const lf = fs.readFileSync(path.join(root, '.claude', 'skills', 'look-and-feel.md'), 'utf-8');
    expect(lf).toContain('CHARACTER.md');
  });
});

// ---- whole workflows -------------------------------------------------------------------------------------------------

describe('the orchestrator with a character', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-orch-'));
  const charPath = path.join(dir, 'CHARACTER.md');
  const saved: Record<string, string | undefined> = {};
  const keys = ['FACTORY_CHARACTER_FILE', 'FACTORY_REQUIRE_CHARACTER', 'FACTORY_LOOKFEEL_FILE', 'FACTORY_MISSION_FILE', 'FACTORY_REQUIRE_MISSION', 'FACTORY_DATA_DIR', 'FACTORY_IGNORE_WIP'];

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(dir, 'data-'));
    process.env.FACTORY_IGNORE_WIP = '1';
    process.env.FACTORY_CHARACTER_FILE = charPath;
    process.env.FACTORY_LOOKFEEL_FILE = path.join(dir, 'no-lookfeel.md');
    process.env.FACTORY_MISSION_FILE = path.join(dir, 'no-mission.md');
    delete process.env.FACTORY_REQUIRE_CHARACTER;
    delete process.env.FACTORY_REQUIRE_MISSION;
    fs.writeFileSync(charPath, charMd);
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const fit = { character_fit: { traits: 'Calm copy that states the next step', moments: 'Failure says so first, then what is safe', deviations: [] } };
  function recorder(over: Record<string, (n: number) => Record<string, unknown>> = {}) {
    const calls: Array<{ agent: string; input: Record<string, any> }> = [];
    const invoker = (async (_s: any, agent: string, input: Record<string, any>) => {
      calls.push({ agent, input });
      const n = calls.filter(c => c.agent === agent).length;
      const base = { phase: agent, valid: true, ...stubPayload(agent), usage };
      if (agent === 'frontend-engineer') return { ...base, ...fit, ...(over[agent]?.(n) ?? {}) };
      return { ...base, ...(over[agent]?.(n) ?? {}) };
    }) as any;
    return { invoker, calls, of: (a: string) => calls.filter(c => c.agent === a) };
  }
  const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);

  it('reads it into the workflow and hands it to the frontend engineer, support and the reviewer only', async () => {
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(state.character!.archetype.primary).toBe('Caregiver');
    expect(state.notes.some(n => n.includes('Character loaded: Caregiver with Sage'))).toBe(true);
    for (const agent of ['frontend-engineer', 'reviewer']) {
      expect(r.of(agent)[0].input.character.archetype.primary).toBe('Caregiver');
      expect(r.of(agent)[0].input.character.archetype_notes).toHaveLength(2);
    }
    for (const agent of ['product-manager', 'analyzer', 'software-architect', 'backend-engineer', 'infrastructure-engineer', 'automation-tester', 'e2e-tester']) {
      expect(r.of(agent)[0].input.character).toBeUndefined();
    }
    expect(Object.keys(r.of('frontend-engineer')[0].input)).toEqual(['character', 'productManagerOutput', 'analyzerOutput', 'architectOutput']);
  });

  it('asks the frontend engineer again when it ignores the character, and fails one that keeps ignoring it', async () => {
    const once = recorder({ 'frontend-engineer': n => (n === 1 ? { character_fit: undefined } : {}) });
    const s1 = await orch(once.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'frontend-engineer' });
    expect(once.of('frontend-engineer')).toHaveLength(2);
    expect(once.of('frontend-engineer')[1].input.repair.problem).toContain('character_fit is missing');
    expect(s1.phases.find(p => p.phase === 'frontend-engineer')!.valid).toBe(true);

    const never = recorder({ 'frontend-engineer': () => ({ character_fit: undefined }) });
    const s2 = await orch(never.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'frontend-engineer' });
    expect(s2.status).toBe('failed');
  });

  it('stops the run on an unusable file, and on a missing one only when it is required', async () => {
    fs.writeFileSync(charPath, '# Character\n');
    const bad = recorder();
    const f = await orch(bad.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(f.status).toBe('failed');
    expect(bad.calls).toHaveLength(0);

    fs.rmSync(charPath);
    const free = recorder();
    const s = await orch(free.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'analyzer' });
    expect(s.status).not.toBe('failed');
    expect(s.notes.some(n => n.includes('No character file'))).toBe(true);
    expect(s.character).toBeUndefined();

    process.env.FACTORY_REQUIRE_CHARACTER = '1';
    const req = recorder();
    const r = await orch(req.invoker).executeWorkflow('Build', 3, {}, undefined, { until: 'analyzer' });
    expect(r.status).toBe('failed');
    expect(req.calls).toHaveLength(0);
  });

  it('loads from the environment variable path', () => {
    expect(loadCharacter(undefined, charPath).found).toBe(true);
    expect(loadCharacter(undefined, path.join(dir, 'nope.md')).found).toBe(false);
  });
});
