import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BULLETS, MAX_BULLET, SECTIONS, checkClaudeMd, pathsIn, sectionsOf } from '../claudemd';

const root = path.join(__dirname, '..', '..');
const template = fs.readFileSync(path.join(root, 'templates', 'project', 'CLAUDE.md'), 'utf-8');
/** The template with every <placeholder> replaced by plain text, the way a project would fill it in. */
const filled = template.replace(/`<[^>\n]*>(?:, `<[^>\n]*>`)*`|<[^>\n]+>/g, m => (m.startsWith('`') ? '`make`' : 'something specific'));
const errors = (md: string, opts = {}) => checkClaudeMd(md, opts).filter(i => i.severity === 'error').map(i => i.message);
const advice = (md: string, opts = {}) => checkClaudeMd(md, opts).filter(i => i.severity === 'warning').map(i => i.message);
const section = (md: string, name: string) => md.split(/\n(?=## )/).find(s => s.startsWith(`## ${name}`)) ?? '';
const without = (md: string, name: string) => md.replace(section(md, name), '');
const bullets = (n: number) => Array.from({ length: n }, (_, i) => `- Bullet number ${i + 1}`).join('\n');

describe('the template', () => {
  it('has the five sections, in order, and is not usable until it is filled in', () => {
    expect(sectionsOf(template).map(s => s.title)).toEqual([...SECTIONS]);
    expect(errors(template)).toEqual(['the file still contains template placeholders (<...>, TODO or TBD)']);
  });
  it('passes once its placeholders are filled in', () => {
    expect(filled).not.toMatch(/<[^>\n]+>/);
    expect(errors(filled)).toEqual([]);
    expect(advice(filled)).toEqual([]);
  });
  it('routes to every writer command and names all four declarations in its rules', () => {
    for (const c of ['mission', 'mission-check', 'character', 'character-check', 'lookfeel', 'lookfeel-check', 'grill', 'language', 'wiki', 'wiki-check', 'commit', 'describe-pr', 'debug', 'iterate-plan', 'handoff', 'resume-handoff']) {
      expect(section(template, 'Skill routing')).toContain(`\`/${c}\``);
    }
    const rules = section(template, 'Working rules');
    for (const w of ['Mission', 'goals', 'Character', 'Look and feel']) expect(rules).toContain(w);
    expect(section(template, 'Knowledge architecture')).toContain('docs/wiki/README.md');
  });
  it('only routes to commands that exist', () => {
    const names = fs.readdirSync(path.join(root, '.claude', 'commands')).map(f => f.replace(/\.md$/, ''));
    for (const m of section(template, 'Skill routing').matchAll(/`\/([a-z-]+)`/g)) expect(names).toContain(m[1]);
  });
  it('stays succinct: bullets only, short, and well under the line limit', () => {
    expect(template.split('\n').length).toBeLessThan(80);
    for (const l of template.split('\n').filter(l => /^- /.test(l))) expect(l.length).toBeLessThanOrEqual(MAX_BULLET);
  });
});

describe('structure', () => {
  it('needs a title and every section', () => {
    expect(errors(filled.replace(/^# .*\n/m, ''))).toContain('there is no "# <Project name>" title');
    for (const name of SECTIONS) expect(errors(without(filled, name))).toContain(`there is no "## ${name}" section`);
  });
  it('ignores section names in comments and code fences', () => {
    expect(errors(`<!-- ## Working rules -->\n${without(filled, 'Working rules')}`)).toContain('there is no "## Working rules" section');
  });
  it('allows only bullets in a section', () => {
    const bad = filled.replace('## Skill routing\n', '## Skill routing\n\nA sentence that is not a bullet.\n');
    expect(errors(bad)).toEqual(['Skill routing: only bullet points belong here, found "A sentence that is not a bullet."']);
    const table = filled.replace('## Skill routing\n', '## Skill routing\n\n| a | b |\n');
    expect(errors(table).join()).toContain('only bullet points');
  });
  it('wants three to fifteen bullets per section', () => {
    const few = filled.replace(section(filled, 'Project lifecycle'), `## Project lifecycle\n\n${bullets(2)}\n\n`);
    expect(errors(few)).toContain(`Project lifecycle: needs ${BULLETS.min} to ${BULLETS.max} bullets, found 2`);
    const many = filled.replace(section(filled, 'Project lifecycle'), `## Project lifecycle\n\n${bullets(16)}\n\n`);
    expect(errors(many)).toContain(`Project lifecycle: needs ${BULLETS.min} to ${BULLETS.max} bullets, found 16`);
  });
  it('rejects a bullet that is too long', () => {
    const long = filled.replace('## Project lifecycle\n', `## Project lifecycle\n\n- ${'word '.repeat(60)}\n`);
    expect(errors(long).join()).toContain(`a bullet is over ${MAX_BULLET} characters`);
  });
  it('advises on sections out of order, extra sections and a long file', () => {
    const swapped = filled.replace(section(filled, 'Skill routing'), '').replace('## Working rules', `${section(filled, 'Skill routing')}\n## Working rules`);
    expect(advice(swapped).join()).toContain('not in the usual order');
    expect(advice(`${filled}\n## Changelog\n\n${bullets(3)}\n`).join()).toContain('"## Changelog" is not one of the five sections');
    expect(advice(`${filled}\n${'\n'.repeat(130)}`).join()).toContain('lines: this file is read at the start of every session');
  });
});

describe('what the sections must say', () => {
  it('requires the wiki in the knowledge architecture', () => {
    const no = filled.replace(/docs\/wiki/g, 'documentation');
    expect(errors(no)).toContain('Knowledge architecture: must mention the wiki (docs/wiki)');
  });
  it('requires the mission, goals, character and look and feel in the working rules', () => {
    const rules = section(filled, 'Working rules');
    expect(errors(filled.replace(rules, rules.replace(/mission/gi, 'purpose')))).toContain('Working rules: must mention the mission');
    expect(errors(filled.replace(rules, rules.replace(/character/gi, 'voice')))).toContain('Working rules: must mention the character');
    expect(errors(filled.replace(rules, rules.replace(/look and feel|lookfeel/gi, 'style')))).toContain('Working rules: must mention the look and feel');
    const noGoals = filled.replace(rules, rules.replace(/goals \(`Gn`\) are optional and cited when they apply/, 'something else'));
    expect(errors(noGoals)).toContain('Working rules: must mention goals');
  });
  it('advises on a routing bullet that names no command or skill', () => {
    const bad = filled.replace('## Skill routing\n', '## Skill routing\n\n- Whenever you feel like it, just ask\n');
    expect(advice(bad).join()).toContain('Skill routing: "Whenever you feel like it');
    expect(advice(filled.replace('## Skill routing\n', '## Skill routing\n\n- Anything else → read `.claude/skills/`\n')).join()).not.toContain('Anything else');
  });
});

describe('paths', () => {
  it('finds paths in backticks and skips commands, urls, globs and placeholders', () => {
    expect(pathsIn('`MISSION.md`, `docs/wiki/`, `src/a.ts`, `npm run build`, `https://x.dev/a`, `/commit`, `src/**`, `<x>/y`, `main`')).toEqual(['MISSION.md', 'docs/wiki/', 'src/a.ts']);
  });
  it('advises on a named path that does not exist, only when it can look', () => {
    const exists = (p: string) => p !== 'CHARACTER.md';
    expect(advice(filled, { exists })).toEqual(['`CHARACTER.md` is named here but does not exist']);
    expect(advice(filled)).toEqual([]);
  });
});

describe('the CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-cli-'));
  const cli = path.join(root, '.factory', 'claudemd-cli.ts');
  const run = (args: string[]) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), cli, ...args], { cwd: dir, encoding: 'utf-8' });

  it('checks a file, reports advice for missing paths, and fails a bad one', () => {
    const good = path.join(dir, 'CLAUDE.md'); fs.writeFileSync(good, filled);
    const r = run(['check']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('0 error(s)');
    expect(r.stdout).toContain('advice: `MISSION.md` is named here but does not exist');
    const bad = path.join(dir, 'bad.md'); fs.writeFileSync(bad, '# Project\n');
    const b = run(['check', bad]);
    expect(b.status).toBe(1);
    expect(b.stdout).toContain('there is no "## How this repo works" section');
    expect(JSON.parse(run(['check', good, '--json']).stdout).every((i: any) => i.severity === 'warning')).toBe(true);
  });
  it('says what to do when there is no file, and shows usage otherwise', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-none-'));
    const r = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), cli, 'check'], { cwd: empty, encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No CLAUDE.md');
    expect(run(['nonsense']).status).toBe(2);
  });
});

describe('the repository', () => {
  it('has the script, the command and the skill, and protects CLAUDE.md', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.scripts['claudemd:check']).toBeDefined();
    expect(fs.existsSync(path.join(root, '.claude', 'commands', 'claude-md.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.claude', 'skills', 'project-claude-md.md'))).toBe(true);
    const adopting = fs.readFileSync(path.join(root, 'docs', 'ADOPTING.md'), 'utf-8');
    expect(adopting).toContain('templates/project/CLAUDE.md');
  });
});
