import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stubPayload, validateContract } from '../contracts';
import { readEvents, replay, stateDifferences } from '../events';
import {
  LookFeel, bestContrast, conformanceProblems, contrast, hexColours, lookFeelForAgents, parseLookFeel, renderLookFeelLine
} from '../lookfeel';
import { CATALOGUE, FEELS, findStyle, shortlist } from '../lookfeel-catalogue';
import { parseMission } from '../mission';
import { FactoryOrchestrator } from '../orchestrator';
import { readSnapshot } from '../state';
import { retryConfig } from './fixtures';

const root = path.join(__dirname, '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'look-and-feel.md'), 'utf-8');
const missionSkill = fs.readFileSync(path.join(root, '.claude', 'skills', 'mission.md'), 'utf-8');
const lookMd = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
const missionMd = /```markdown\n([\s\S]*?)```/.exec(missionSkill)![1];
const mp = parseMission(missionMd);
if (!mp.ok) throw new Error('the mission skill example must parse');
const mission = mp.mission;

const errorsOf = (md: string, m = mission): string[] => {
  const r = parseLookFeel(md, m);
  return r.ok ? [] : r.errors;
};
const ok = (md: string, m = mission): LookFeel => {
  const r = parseLookFeel(md, m);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.lookFeel;
};
/** The example from the skill with one thing changed. */
const edit = (from: string | RegExp, to: string): string => lookMd.replace(from, to);

const NAMES = [
  'Wabi-Sabi', 'Ma', 'Feng Shui', 'Imperial Symmetry', 'Vastu Shastra', 'Mughal Symmetry', 'Temple Fractalism', 'Nomadic Modularism',
  'Islamic Geometry', 'Persian Garden', 'African Fractalism', 'Vernacular Earth', 'Mesoamerican', 'Roman Classical', 'Gothic', 'Bauhaus',
  'Art Nouveau', 'Art Deco', 'Biophilic Design', 'Circular Design', 'Material Design', 'Scandinavian Design', 'Slow Design', 'Brutalism',
  'High-Tech Architecture', 'Minimalism', 'Japandi', 'Indo-Saracenic', 'Mid-Century Modern', 'Post-modernism', 'Solarpunk', 'Industrial Chic',
  'Steampunk', 'Biomorphic'
];

describe('the catalogue', () => {
  it('has every style that was asked for, under those names, and nothing else', () => {
    expect(CATALOGUE.map(s => s.name)).toEqual(NAMES);
  });
  it('describes each style in every layer', () => {
    for (const st of CATALOGUE) {
      for (const k of ['origin', 'essence', 'materials', 'form', 'colour', 'motion', 'sound', 'interaction', 'care'] as const) {
        const min = k === 'origin' ? 4 : 12;
        expect({ style: st.name, field: k, ok: st[k].trim().length >= min }).toEqual({ style: st.name, field: k, ok: true });
      }
      expect(st.feel.length).toBeGreaterThanOrEqual(2);
      expect(st.feel.every(f => FEELS.includes(f))).toBe(true);
    }
  });
  it('uses every feeling at least twice, so each shortlist has something to offer', () => {
    for (const f of FEELS) expect(CATALOGUE.filter(s => s.feel.includes(f)).length).toBeGreaterThanOrEqual(2);
  });
  it('finds a style by name, alias, case or hyphen, and no alias points at two styles', () => {
    expect(findStyle('wabi sabi')?.name).toBe('Wabi-Sabi');
    expect(findStyle('HIGH TECH')?.name).toBe('High-Tech Architecture');
    expect(findStyle('Indo Saracenic')?.name).toBe('Indo-Saracenic');
    expect(findStyle('Scandinavian')?.name).toBe('Scandinavian Design');
    expect(findStyle('')).toBeUndefined();
    expect(findStyle('Baroque')).toBeUndefined();
    const keys = CATALOGUE.flatMap(s => [s.name, ...s.aliases]).map(n => n.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('tells people to take principles, not sacred or ethnic imagery, from the living traditions', () => {
    for (const n of ['Feng Shui', 'Vastu Shastra', 'Temple Fractalism', 'Islamic Geometry', 'African Fractalism', 'Mesoamerican', 'Indo-Saracenic']) {
      expect({ n, careful: /\b(not|avoid|never|acknowledge|credit)\b/i.test(findStyle(n)!.care) }).toEqual({ n, careful: true });
    }
  });
  it('shortlists by shared feeling, best first, in catalogue order on ties', () => {
    const r = shortlist(['calm', 'handmade', 'natural']);
    expect(r[0].style.name).toBe('Wabi-Sabi');
    expect(r.map(x => x.matched.length)).toEqual([...r.map(x => x.matched.length)].sort((a, b) => b - a));
    expect(shortlist(['calm'], 3)).toHaveLength(3);
    expect(shortlist([])).toEqual([]);
  });
});

describe('colour', () => {
  it('reads hex colours of both lengths', () => {
    expect(hexColours('Paper #F6F3EE, ink #1f2a2e and #abc; not #12 or #ggg')).toEqual(['#f6f3ee', '#1f2a2e', '#abc']);
  });
  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrast('#fff', '#fff')).toBe(1);
    expect(bestContrast(['#f6f3ee', '#1f2a2e', '#3f6b6a'])).toBeGreaterThan(10);
  });
});

describe('parseLookFeel', () => {
  it('reads the example in the skill, checked against the mission example', () => {
    const lf = ok(lookMd);
    expect(lf.direction).toMatchObject({ primary: 'Scandinavian Design', secondary: 'Japandi' });
    expect(lf.motion.reducedMotion).toContain('instant fades');
    expect(lf.sound.control).toContain('Off by default');
    expect(renderLookFeelLine(lf)).toBe('Scandinavian Design with Japandi');
    const r = parseLookFeel(lookMd, mission);
    expect(r.ok && r.warnings).toEqual([]);
  });
  it('also reads it without a mission, which then cannot check the reasoning', () => {
    expect(parseLookFeel(lookMd).ok).toBe(true);
    const loose = edit(/- Why: .*\n/, '- Why: it feels light and orderly and calm\n');
    expect(parseLookFeel(loose).ok).toBe(true);
    expect(parseLookFeel(loose, mission).ok).toBe(false);
  });
  it('turns away the template until it is filled in', () => {
    const template = fs.readFileSync(path.join(root, 'templates', 'project', 'LOOKFEEL.md'), 'utf-8');
    const errs = errorsOf(template);
    expect(errs).toEqual(expect.arrayContaining([expect.stringContaining('template placeholders'), expect.stringContaining('Palette')]));
  });
  it('names the section or line that is missing, and lines that say nothing', () => {
    expect(errorsOf('# Look and feel\n')).toEqual(expect.arrayContaining(['there is no "## Direction" section', 'there is no "## Sound" section']));
    expect(errorsOf(edit(/- Texture: .*\n/, ''))).toEqual(['Materials has no "Texture:" line']);
    expect(errorsOf(edit(/- Reduced motion: .*\n/, ''))).toEqual(['Motion has no "Reduced motion:" line']);
    expect(errorsOf(edit(/- Voice: .*\n/, '- Voice: nice\n'))).toEqual(['Tone "Voice" is too short to decide anything']);
    expect(errorsOf(edit(/- Say: .*\n/, `- Say: ${'x'.repeat(501)}\n`))).toEqual([expect.stringContaining('longer than 500')]);
  });
  it('accepts American spelling, bold keys and other headings of the same kind', () => {
    const md = edit('## Colour and type', '## Color and type').replace('## Interaction feel', '## Interaction').replace(/- (Voice):/, '- **$1**:');
    expect(parseLookFeel(md, mission).ok).toBe(true);
  });

  describe('direction', () => {
    it('needs styles from the catalogue, tolerates a note in brackets, allows a named custom one with advice', () => {
      expect(errorsOf(edit('Primary: Scandinavian Design', 'Primary: Baroque'))).toEqual([expect.stringContaining('"Baroque" is not a style in the catalogue')]);
      expect(ok(edit('Primary: Scandinavian Design', 'Primary: Wabi-Sabi (lightly)')).direction.primary).toBe('Wabi-Sabi (lightly)');
      const r = parseLookFeel(edit('Primary: Scandinavian Design', 'Primary: Custom: Harbour Modern'), mission);
      expect(r.ok && r.warnings.join()).toContain('not in the catalogue');
    });
    it('does not repeat the primary as the secondary, and may leave the secondary out', () => {
      expect(errorsOf(edit('Secondary: Japandi', 'Secondary: scandinavian'))).toEqual(['Secondary is the same style as Primary']);
      const lf = ok(edit(/- Secondary: .*\n/, ''));
      expect(lf.direction.secondary).toBeUndefined();
      expect(renderLookFeelLine(lf)).toBe('Scandinavian Design');
    });
    it('with a mission, the Why has to cite what it serves and only real ids', () => {
      expect(errorsOf(edit(/- Why: .*\n/, '- Why: because it looks nice and clean\n'))).toEqual([expect.stringContaining('must tie the choice to the mission')]);
      expect(errorsOf(edit('BC1 and BC2', 'BC1 and BC9'))).toEqual([expect.stringContaining('cites BC9, which the mission does not have')]);
      expect(errorsOf(edit(/- Why: .*\n/, '- Why: a quiet product that protects G2 and BC1 in daily use\n'))).toEqual([]);
    });
  });

  describe('colour', () => {
    it('needs three hex colours and a readable pair', () => {
      expect(errorsOf(edit(/- Palette: .*\n/, '- Palette: Paper #f6f3ee and Ink #1f2a2e\n'))).toEqual([expect.stringContaining('at least three colours')]);
      expect(errorsOf(edit(/- Palette: .*\n/, '- Palette: Sand #e8e0d0, Cream #f3ecdc, Stone #d6cdb8\n'))).toEqual([expect.stringContaining('4.5:1 contrast')]);
    });
    it('advises when the palette is not a decision', () => {
      const many = Array.from({ length: 9 }, (_, i) => `#${(i * 20 + 16).toString(16).padStart(2, '0')}2a2e`).join(', ');
      const r = parseLookFeel(edit(/- Palette: .*\n/, `- Palette: Paper #ffffff, ${many}\n`), mission);
      expect(r.ok && r.warnings.join()).toContain('more than eight colours');
    });
  });

  describe('motion and sound', () => {
    it('advises on long animations', () => {
      const r = parseLookFeel(edit('150 to 300 ms ease-out, no bounce', '2 s ease-in-out'), mission);
      expect(r.ok && r.warnings.join()).toContain('2000 ms');
      expect(parseLookFeel(lookMd, mission).ok && (parseLookFeel(lookMd, mission) as any).warnings).toEqual([]);
    });
    it('asks for the character, the moments and an off switch when there is sound', () => {
      expect(errorsOf(edit(/- Character: A short.*\n/, ''))).toEqual(['Sound "Character:" is required when the product makes sounds']);
      expect(errorsOf(edit(/- Moments: .*\n/, ''))).toEqual([expect.stringContaining('"Moments:" is required')]);
      expect(errorsOf(edit(/- Control: .*\n/, '- Control: Always playing at a pleasant level\n'))).toEqual([expect.stringContaining('how a person turns sound off')]);
    });
    it('lets a product choose silence, and drops what a silent product does not need', () => {
      const silent = edit(/- Use: .*\n- Character: .*\n- Moments: .*\n- Control: .*\n/, '- Use: None. This product is silent.\n- Control: There is nothing to turn off\n');
      const lf = ok(silent);
      expect(lf.sound.character).toBeUndefined();
      expect(lf.sound.moments).toBeUndefined();
    });
  });
});

describe('what agents receive', () => {
  const lf = ok(lookMd);
  it('is the declaration plus the catalogue notes for each chosen style', () => {
    const v = lookFeelForAgents(lf) as any;
    expect(Object.keys(v)).toEqual(['direction', 'tone', 'materials', 'colour_and_type', 'motion', 'sound', 'interaction', 'style_notes']);
    expect(v.style_notes.map((n: any) => n.style)).toEqual(['Scandinavian Design', 'Japandi']);
    expect(v.style_notes[0]).toMatchObject({ essence: expect.any(String), sound: expect.any(String), watch_for: expect.any(String) });
  });
  it('has no notes for a custom style', () => {
    const custom = ok(edit('Primary: Scandinavian Design', 'Primary: Custom: Harbour Modern').replace('Secondary: Japandi', 'Secondary: Minimalism'));
    expect((lookFeelForAgents(custom) as any).style_notes.map((n: any) => n.style)).toEqual(['Minimalism']);
  });
});

describe('the frontend engineer owes a statement of conformance', () => {
  const good = { look_and_feel: { style: 'Scandinavian paper surfaces', materials: 'Matte cards, 6px corners', motion: '150 to 300 ms ease-out with reduced motion fades', sound: 'Tap on sent, off by default', interaction: 'One action per screen', deviations: [] } };
  it('checks the five areas and the list of deviations', () => {
    expect(conformanceProblems(good)).toEqual([]);
    expect(conformanceProblems({})[0]).toContain('look_and_feel is missing');
    expect(conformanceProblems({ look_and_feel: { ...good.look_and_feel, sound: 'ok' } })).toEqual(['look_and_feel.sound must say how the work follows the sound']);
    expect(conformanceProblems({ look_and_feel: { ...good.look_and_feel, deviations: 'none' } })).toEqual([expect.stringContaining('deviations must be a list')]);
  });
  it('as a contract, only when the project has declared a look and feel', () => {
    const reply = { phase: 'frontend-engineer', valid: true, ...stubPayload('frontend-engineer') };
    expect(validateContract(reply, 'frontend-engineer')).toEqual([]);
    expect(validateContract(reply, 'frontend-engineer', { lookfeel: ok(lookMd) })[0]).toContain('look_and_feel is missing');
    expect(validateContract({ ...reply, ...good }, 'frontend-engineer', { lookfeel: ok(lookMd) })).toEqual([]);
    expect(validateContract({ phase: 'frontend-engineer', valid: false, error: 'no', blockers: [{ a: 1 }] }, 'frontend-engineer', { lookfeel: ok(lookMd) })).toEqual([]);
  });
});

describe('the commands', () => {
  const cli = (...args: string[]) => spawnSync('npx', ['ts-node', '.factory/lookfeel-cli.ts', ...args], { cwd: root, encoding: 'utf-8' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookfeel-'));

  it('check reads a file, says what is wrong and exits accordingly', () => {
    const good = path.join(dir, 'good.md');
    const bad = path.join(dir, 'bad.md');
    fs.writeFileSync(good, lookMd);
    fs.writeFileSync(bad, '# Look and feel\n');
    const g = cli('check', good);
    expect(g.status).toBe(0);
    expect(g.stdout).toContain('Scandinavian Design with Japandi');
    expect(JSON.parse(cli('check', good, '--json').stdout).style_notes).toHaveLength(2);
    const b = cli('check', bad);
    expect(b.status).toBe(1);
    expect(b.stderr).toContain('cannot be used');
    expect(cli('check', path.join(dir, 'missing.md')).status).toBe(1);
  });
  it('lists the catalogue, describes a style and shortlists by feeling', () => {
    const list = cli('catalogue');
    expect(list.status).toBe(0);
    expect(list.stdout.split('\n').filter(l => /^[A-Z]/.test(l) && !l.startsWith('Feelings')).length).toBe(34);
    const one = cli('catalogue', 'wabi', 'sabi');
    expect(one.stdout).toContain('Wabi-Sabi (Japan)');
    expect(one.stdout).toContain('sound');
    expect(cli('catalogue', 'Baroque').status).toBe(1);
    const short = cli('shortlist', 'calm,handmade');
    expect(short.status).toBe(0);
    expect(short.stdout.split('\n').filter(Boolean)).toHaveLength(5);
    expect(cli('shortlist', 'sparkly').status).toBe(2);
    expect(cli('nope').status).toBe(2);
  });
  it('the commands and the skill point at real things', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).scripts;
    expect(scripts.lookfeel).toBeDefined();
    expect(scripts['lookfeel:check']).toBeDefined();
    const cmd = fs.readFileSync(path.join(root, '.claude', 'commands', 'lookfeel.md'), 'utf-8');
    expect(cmd).toContain('/mission');
    expect(cmd.indexOf('shortlist')).toBeLessThan(cmd.indexOf('Let the user choose'));
    expect(fs.readFileSync(path.join(root, '.claude', 'commands', 'lookfeel-check.md'), 'utf-8')).toContain('prefers-reduced-motion');
    const policy = JSON.parse(fs.readFileSync(path.join(root, '.factory', 'policy.json'), 'utf-8'));
    expect(policy.protected_paths).toEqual(expect.arrayContaining(['MISSION.md', 'LOOKFEEL.md']));
    for (const layer of ['Direction', 'Tone', 'Materials', 'Colour and type', 'Motion', 'Sound', 'Interaction feel']) expect(skill).toContain(layer);
  });
});

// ---- whole workflows -------------------------------------------------------------------------------------------------

describe('the orchestrator with a look and feel', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookfeel-orch-'));
  const lookPath = path.join(dir, 'LOOKFEEL.md');
  const missionPath = path.join(dir, 'MISSION.md');
  const saved: Record<string, string | undefined> = {};
  const keys = ['FACTORY_LOOKFEEL_FILE', 'FACTORY_REQUIRE_LOOKFEEL', 'FACTORY_MISSION_FILE', 'FACTORY_REQUIRE_MISSION', 'FACTORY_DATA_DIR', 'FACTORY_IGNORE_WIP'];

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(dir, 'data-'));
    process.env.FACTORY_IGNORE_WIP = '1';
    process.env.FACTORY_LOOKFEEL_FILE = lookPath;
    process.env.FACTORY_MISSION_FILE = path.join(dir, 'no-mission.md');
    delete process.env.FACTORY_REQUIRE_LOOKFEEL;
    delete process.env.FACTORY_REQUIRE_MISSION;
    fs.writeFileSync(lookPath, lookMd);
    fs.rmSync(missionPath, { force: true });
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const conforming = { look_and_feel: { style: 'Scandinavian paper', materials: 'Matte cards with 6px corners', motion: '150 to 300 ms ease-out, reduced motion fades', sound: 'Tap on sent, off by default', interaction: 'One action per screen', deviations: [] } };
  function recorder(over: Record<string, (n: number) => Record<string, unknown>> = {}) {
    const calls: Array<{ agent: string; input: Record<string, any> }> = [];
    const invoker = (async (_s: any, agent: string, input: Record<string, any>) => {
      calls.push({ agent, input });
      const n = calls.filter(c => c.agent === agent).length;
      const base = { phase: agent, valid: true, ...stubPayload(agent), usage };
      if (agent === 'frontend-engineer') return { ...base, ...conforming, ...(over[agent]?.(n) ?? {}) };
      return { ...base, ...(over[agent]?.(n) ?? {}) };
    }) as any;
    return { invoker, calls, of: (a: string) => calls.filter(c => c.agent === a) };
  }
  const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);

  it('reads it into the workflow and hands it to the frontend engineer, support and the reviewer only', async () => {
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(state.lookfeel!.direction.primary).toBe('Scandinavian Design');
    expect(state.notes.some(n => n.includes('Look and feel loaded: Scandinavian Design with Japandi'))).toBe(true);
    for (const agent of ['frontend-engineer', 'reviewer']) {
      expect(r.of(agent)[0].input.lookfeel.direction.primary).toBe('Scandinavian Design');
      expect(r.of(agent)[0].input.lookfeel.style_notes).toHaveLength(2);
    }
    for (const agent of ['product-manager', 'analyzer', 'software-architect', 'backend-engineer', 'infrastructure-engineer', 'automation-tester', 'e2e-tester']) {
      expect(r.of(agent)[0].input.lookfeel).toBeUndefined();
    }
    // stable parts first: the declared look and feel is the same for every call, the other outputs are not
    expect(Object.keys(r.of('frontend-engineer')[0].input)).toEqual(['lookfeel', 'productManagerOutput', 'analyzerOutput', 'architectOutput']);
  });

  it('asks the frontend engineer again when it ignores the declaration, and fails one that keeps ignoring it', async () => {
    const once = recorder({ 'frontend-engineer': n => (n === 1 ? { look_and_feel: undefined } : {}) });
    const s1 = await orch(once.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'frontend-engineer' });
    expect(once.of('frontend-engineer')).toHaveLength(2);
    expect(once.of('frontend-engineer')[1].input.repair.problem).toContain('look_and_feel is missing');
    expect(s1.phases.find(p => p.phase === 'frontend-engineer')!.valid).toBe(true);

    const never = recorder({ 'frontend-engineer': () => ({ look_and_feel: undefined }) });
    const s2 = await orch(never.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'frontend-engineer' });
    expect(s2.status).toBe('failed');
    expect(s2.phases.find(p => p.phase === 'frontend-engineer')!.error).toContain('look_and_feel is missing');
  });

  it('is checked against the mission when the project has one', async () => {
    fs.writeFileSync(missionPath, missionMd);
    process.env.FACTORY_MISSION_FILE = missionPath;
    const r = recorder({ 'product-manager': () => ({ features: { must_have: [{ name: 'F', serves: ['BC1'] }] }, mission_alignment: { behaviour_changes_covered: ['BC1'], behaviour_changes_not_covered: ['BC2'], out_of_mission: [] } }) });
    const good = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(good.status).toBe('paused');
    expect(good.lookfeel).toBeDefined();

    fs.writeFileSync(lookPath, lookMd.replace(/- Why: .*\n/, '- Why: it feels light and orderly\n'));
    const r2 = recorder();
    const bad = await orch(r2.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'analyzer' });
    expect(bad.status).toBe('failed');
    expect(r2.calls).toHaveLength(0);
    expect(bad.notes.some(n => n.includes('Look and feel file') && n.includes('must tie the choice to the mission'))).toBe(true);
  });

  it('stops on a file it cannot use; carries on without one unless it is required', async () => {
    fs.writeFileSync(lookPath, '# Look and feel\n');
    const r = recorder();
    const bad = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(bad.status).toBe('failed');
    expect(r.calls).toHaveLength(0);

    fs.rmSync(lookPath);
    const free = recorder();
    const s = await orch(free.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'analyzer' });
    expect(s.status).toBe('paused');
    expect(s.lookfeel).toBeUndefined();
    expect(s.notes.some(n => n.includes('No look and feel file'))).toBe(true);

    process.env.FACTORY_REQUIRE_LOOKFEEL = '1';
    const req = recorder();
    const f = await orch(req.invoker).executeWorkflow('Build', 3, {}, undefined, { until: 'analyzer' });
    expect(f.status).toBe('failed');
    expect(f.notes.some(n => n.includes('FACTORY_REQUIRE_LOOKFEEL is on'))).toBe(true);
    expect(req.calls).toHaveLength(0);
  });

  it('a resumed workflow keeps the look and feel it started with', async () => {
    const r = recorder();
    const o = orch(r.invoker);
    const stopped = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    fs.writeFileSync(lookPath, lookMd.replace('Primary: Scandinavian Design', 'Primary: Brutalism'));
    await o.executeWorkflow('Build', 1, {}, stopped, { until: 'frontend-engineer' });
    expect(r.of('frontend-engineer')[0].input.lookfeel.direction.primary).toBe('Scandinavian Design');
  });

  it('the event log replays a state that has one', async () => {
    const r = recorder();
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(stateDifferences(replay(readEvents(state.id).events)!, readSnapshot(state.id)!)).toEqual([]);
    expect(readSnapshot(state.id)!.lookfeel!.direction.primary).toBe('Scandinavian Design');
  });
});
