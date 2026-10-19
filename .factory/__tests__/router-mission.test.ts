import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadBoard } from '../board';
import {
  Declaration, MissionGate, alignmentProblems, checkDeclaration, parseDeclaration, parseMission
} from '../mission';
import { DEFAULT_BUDGET, RouteInput, emptyLedger, route } from '../route';

const root = path.join(__dirname, '..', '..');
const board = loadBoard(path.join(root, '.factory', 'board.json'));
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'mission.md'), 'utf-8');
const missionMd = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
const parsed = parseMission(missionMd);
if (!parsed.ok) throw new Error('the skill example must parse');
const mission = parsed.mission;
const NOW = new Date('2026-10-19T12:00:00Z');

const okGate: MissionGate = { state: 'ok', behaviourChanges: mission.behaviourChanges.map(c => ({ id: c.id, name: c.name })) };
const none: Declaration = { serves: [], problems: [] };

describe('parseDeclaration', () => {
  it('reads Serves: lines in the usual spellings', () => {
    expect(parseDeclaration('Serves: BC1').serves).toEqual(['BC1']);
    expect(parseDeclaration('- **Serves:** bc1, BC3 and bc2').serves).toEqual(['BC1', 'BC3', 'BC2']);
    expect(parseDeclaration('intro\n\nServes: BC1\nserves: BC1; BC4\n').serves).toEqual(['BC1', 'BC4']);
  });
  it('reads a Mission exception with its reason', () => {
    expect(parseDeclaration('Mission exception: the old API goes away in March').exception).toBe('the old API goes away in March');
    expect(parseDeclaration('* Mission Exception : legal asked for this').exception).toBe('legal asked for this');
  });
  it('says what it cannot use', () => {
    expect(parseDeclaration('Serves: <BC id from MISSION.md>').problems).toEqual(expect.arrayContaining([expect.stringContaining('is not a behaviour change id')]));
    expect(parseDeclaration('Serves:').problems).toEqual(['"Serves:" names no behaviour change']);
    expect(parseDeclaration('Serves: invoicing').problems[0]).toContain('"invoicing" is not a behaviour change id');
    expect(parseDeclaration('Mission exception: later').problems[0]).toContain('reason of at least 10 characters');
  });
  it('ignores quotes, code, comments and mentions in the middle of a sentence', () => {
    expect(parseDeclaration('> Serves: BC1\n```\nServes: BC2\n```\n<!-- Serves: BC3 -->\nThis serves BC4 mostly.\nSee Serves: BC5').serves).toEqual([]);
  });
});

describe('checkDeclaration', () => {
  it('needs nothing from a project without a mission, unless it requires one', () => {
    expect(checkDeclaration({ state: 'none', required: false }, none)).toEqual({ ok: true });
    const r = checkDeclaration({ state: 'none', required: true }, none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons[0]).toContain('FACTORY_REQUIRE_MISSION is on');
  });
  it('waits on an unusable mission file', () => {
    const r = checkDeclaration({ state: 'unusable', errors: ['the mission statement is too short'] }, { serves: ['BC1'], problems: [] });
    expect(r).toEqual({ ok: false, reasons: [expect.stringContaining('cannot be used')] });
  });
  it('asks an issue that says nothing to name a behaviour change, listing them', () => {
    const r = checkDeclaration(okGate, none);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasons[0]).toContain('does not say which behaviour change it serves');
      expect(r.reasons[0]).toContain('BC1 Invoice at the moment of delivery; BC2 Stop chasing by hand');
      expect(r.reasons[1]).toContain('Mission exception:');
      expect(r.reasons[1]).toContain('re-apply the label');
    }
  });
  it('lets an issue through that names real behaviour changes, or a reasoned exception', () => {
    expect(checkDeclaration(okGate, { serves: ['BC1', 'BC2'], problems: [] })).toEqual({ ok: true, note: 'mission: serves BC1, BC2' });
    const e = checkDeclaration(okGate, { serves: [], exception: 'a customer contract requires it', problems: [] });
    expect(e).toEqual({ ok: true, note: 'mission: exception declared (a customer contract requires it)' });
  });
  it('turns away ids the mission lacks and malformed lines', () => {
    const unknown = checkDeclaration(okGate, { serves: ['BC1', 'BC7'], problems: [] });
    expect(unknown.ok === false && unknown.reasons[0]).toContain('serves BC7, which MISSION.md does not have');
    const bad = checkDeclaration(okGate, { serves: [], problems: ['"x" is not a behaviour change id (they look like BC1)'] });
    expect(bad.ok === false && bad.reasons[0]).toContain('is not a behaviour change id');
  });
});

describe('route with the mission check', () => {
  function input(over: Partial<RouteInput> = {}, labels: string[] = ['agent:ready', 'lane:short']): RouteInput {
    return {
      enabled: true,
      sender: { login: 'alice', permission: 'write' },
      issue: { number: 7, labels, declaration: none },
      oracle: { state: 'online', unavailableMinutes: 0 },
      ledger: emptyLedger(NOW),
      budget: DEFAULT_BUDGET,
      board,
      wip: { inProgress: 0, inReview: 0 },
      now: NOW,
      mission: okGate,
      ...over
    };
  }

  it('waits, before lane or budget are looked at, when the issue names no behaviour change', () => {
    const d = route(input());
    expect(d.action).toBe('wait');
    expect(d.reasons[0]).toContain('does not say which behaviour change it serves');
    expect(d.reasons.join(' ')).not.toContain('wants');
  });
  it('starts, and says so in the claim reasons, when it does', () => {
    const d = route(input({ issue: { number: 7, labels: ['agent:ready', 'lane:short'], declaration: { serves: ['BC2'], problems: [] } } }));
    expect(d.action).toBe('start');
    expect(d.reasons).toEqual(expect.arrayContaining(['mission: serves BC2']));
  });
  it('starts on a declared exception', () => {
    const d = route(input({ issue: { number: 7, labels: ['agent:ready', 'lane:short'], declaration: { serves: [], exception: 'security fix demanded by an audit', problems: [] } } }));
    expect(d.action).toBe('start');
    expect(d.reasons.join(' ')).toContain('exception declared');
  });
  it('does not ask review, gate or triage tasks, which plan no product work', () => {
    for (const kind of ['review', 'gate', 'triage']) {
      expect(route(input({}, ['agent:ready', `task:${kind}`])).action).toBe('start');
    }
    expect(route(input({}, ['agent:ready', 'task:pipeline'])).action).toBe('wait');
    expect(route(input({}, ['agent:ready', 'task:small-fix'])).action).toBe('wait');
  });
  it('checks nothing without a mission, and the earlier rules still come first', () => {
    expect(route(input({ mission: undefined })).action).toBe('start');
    expect(route(input({ mission: { state: 'none', required: false } })).action).toBe('start');
    expect(route(input({ mission: { state: 'none', required: true } })).action).toBe('wait');
    expect(route(input({ sender: { login: 'bob', permission: 'read' } })).action).toBe('ignore');
    expect(route(input({}, ['lane:short'])).action).toBe('ignore');
    expect(route(input({ enabled: false })).action).toBe('ignore');
  });
  it('then applies the board limits as before', () => {
    const d = route(input({ issue: { number: 7, labels: ['agent:ready', 'lane:short'], declaration: { serves: ['BC1'], problems: [] } }, wip: { inProgress: 1, inReview: 2 } }));
    expect(d.action).toBe('wait');
    expect(d.reasons.join(' ')).not.toContain('behaviour change');
  });
});

describe('what the product manager owes the declaration', () => {
  const reply = (over: Record<string, unknown> = {}) => ({
    features: { must_have: [{ name: 'Send invoice', serves: ['BC1'] }], nice_to_have: [] },
    mission_alignment: { behaviour_changes_covered: ['BC1'], behaviour_changes_not_covered: ['BC2'], out_of_mission: [] },
    ...over
  });
  it('must deliver on the behaviour changes the issue says it serves', () => {
    expect(alignmentProblems(mission, reply(), { serves: ['BC1'] })).toEqual([]);
    expect(alignmentProblems(mission, reply(), { serves: ['BC1', 'BC2'] })).toEqual([expect.stringContaining('no feature serves BC2')]);
    expect(alignmentProblems(mission, reply(), { serves: ['BC9'] })).toEqual([]);
  });
  it('may keep a must-have out of mission only when a person declared the exception', () => {
    const r = reply({
      features: { must_have: [{ name: 'Audit log' }], nice_to_have: [] },
      mission_alignment: { behaviour_changes_covered: [], behaviour_changes_not_covered: ['BC1', 'BC2'], out_of_mission: [{ feature: 'Audit log', reason: 'Mission exception: audit demand' }] }
    });
    expect(alignmentProblems(mission, r)[0]).toContain('must-have feature "Audit log" is listed as out of mission');
    expect(alignmentProblems(mission, r, { exception: true })).toEqual([]);
  });
});

// ---- the real decide command, against a fake gh ----------------------------------------------------------------------

describe('route-cli decide', () => {
  function sandbox(opts: { body: string; labels?: string[]; mission?: string | null; env?: Record<string, string> }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-mission-'));
    const bin = path.join(dir, 'bin');
    const work = path.join(dir, 'work');
    fs.mkdirSync(bin);
    fs.mkdirSync(work);
    if (opts.mission !== null) fs.writeFileSync(path.join(work, 'MISSION.md'), opts.mission ?? missionMd);
    const log = path.join(dir, 'calls.log');
    const issue = JSON.stringify({
      number: 7, labels: (opts.labels ?? ['agent:ready', 'lane:short']).map(name => ({ name })), author: { login: 'alice' }, body: opts.body, title: 'A thing'
    });
    fs.writeFileSync(path.join(dir, 'issue.json'), issue);
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
case "$*" in
  *"/permission"*) echo write ;;
  "issue view"*) cat "${path.join(dir, 'issue.json')}" ;;
  "issue list"*) echo '[{"number":9,"body":""}]' ;;
  "pr list"*) echo '[]' ;;
  "variable get"*) exit 1 ;;
  "label create"*) ;;
  "issue edit"*) echo "gh $*" >> "${log}" ;;
  *"--paginate"*) ;;
  "api repos/o/r/issues/7/comments"*) echo "POST $(cat | tr '\\n' '~')" >> "${log}"; echo 100 ;;
  *) echo "unexpected gh $*" >> "${log}"; exit 1 ;;
esac
`, { mode: 0o755 });
    const run = () => spawnSync(path.join(root, 'node_modules', '.bin', 'ts-node'), [path.join(root, '.factory', 'route', 'cli.ts'), 'decide'], {
      cwd: work, encoding: 'utf-8',
      env: {
        PATH: `${bin}:${process.env.PATH}`, HOME: dir, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', ISSUE_NUMBER: '7', ACTOR: 'alice', RUN_ID: '5',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'), ...opts.env
      }
    });
    return { run, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : []) };
  }

  it('waits, with the choices in the comment and the labels untouched, for an issue that names no behaviour change', () => {
    const s = sandbox({ body: 'Please add reminders.' });
    const r = s.run();
    expect(r.stdout).toContain('action=wait');
    const calls = s.calls();
    expect(calls.filter(c => c.startsWith('gh issue edit') && c.includes('9'))).toEqual([]);
    expect(calls.some(c => c.includes('agent:working'))).toBe(false);
    const post = calls.find(c => c.startsWith('POST'))!;
    expect(post).toContain('Agent work is waiting, nothing was started');
    expect(post).toContain('BC1 Invoice at the moment of delivery');
    expect(post).toContain('Mission exception:');
  });

  it('claims the issue when it names a behaviour change, and says which in the claim', () => {
    const s = sandbox({ body: 'Please add reminders.\n\nServes: BC2' });
    const r = s.run();
    expect(r.stdout).toContain('action=start');
    expect(r.stdout).toContain('lane=short');
    const calls = s.calls();
    expect(calls.some(c => c.startsWith('gh issue edit 7 --add-label agent:working'))).toBe(true);
    expect(calls.find(c => c.startsWith('POST') && c.includes('Agent work started'))).toContain('mission: serves BC2');
  });

  it('does not check a project that has no mission, unless the variable requires one', () => {
    const free = sandbox({ body: 'No declaration here', mission: null });
    expect(free.run().stdout).toContain('action=start');
    const required = sandbox({ body: 'No declaration here', mission: null, env: { FACTORY_REQUIRE_MISSION: '1' } });
    const r = required.run();
    expect(r.stdout).toContain('action=wait');
    expect(required.calls().find(c => c.startsWith('POST'))).toContain('FACTORY_REQUIRE_MISSION is on');
  });

  it('waits on a mission file it cannot use', () => {
    const s = sandbox({ body: 'Serves: BC1', mission: '# Mission\n\nShort.\n' });
    expect(s.run().stdout).toContain('action=wait');
    expect(s.calls().find(c => c.startsWith('POST'))).toContain('MISSION.md cannot be used');
  });
});

describe('the documents', () => {
  it('the issue template carries the line the router looks for and is refused until filled in', () => {
    const t = fs.readFileSync(path.join(root, 'templates', 'project', 'ISSUE_TEMPLATE', 'agent-task.md'), 'utf-8');
    const decl = parseDeclaration(t);
    expect(decl.serves).toEqual([]);
    expect(decl.problems.length).toBeGreaterThan(0);
    expect(t).toContain('Mission exception:');
    expect(skill).toContain('Serves:');
    expect(skill).toContain('Mission exception:');
  });
});

describe('running from source', () => {
  it('resolves board.ts, not board.json, under ts-node (the router and the orchestrator import it)', () => {
    const r = spawnSync(path.join(root, 'node_modules', '.bin', 'ts-node'), ['-e', "const b = require('./.factory/board'); process.stdout.write(typeof b.loadBoard + ' ' + typeof b.evaluateWip)"], { cwd: root, encoding: 'utf-8' });
    expect(r.stdout).toBe('function function');
  });
});
