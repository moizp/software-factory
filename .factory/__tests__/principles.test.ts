import * as fs from 'fs';
import * as path from 'path';
import { pathsIn } from '../claudemd';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf-8');
const skill = read('.claude', 'skills', 'principles.md');

describe('the principles skill', () => {
  it('has the five principles, in order', () => {
    const heads = [...skill.matchAll(/^## (\d)\. (.+)$/gm)].map(m => `${m[1]}. ${m[2]}`);
    expect(heads).toEqual([
      '1. Human-centric augmentation over total automation',
      '2. Architectural integrity: deep modules and system health',
      '3. Alignment, shared understanding, co-evolution',
      '4. Tight feedback loops and continuous learning',
      '5. Value beyond superficial metrics'
    ]);
  });
  it('says for every rule whether it is built, so a prompt is not mistaken for a guarantee', () => {
    const rows = skill.split('\n').filter(l => /^\| /.test(l) && !/^\|[-| ]+\|$/.test(l) && !/^\| Rule /.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const r of rows) expect(r.split('|').filter(c => c.trim()).length).toBe(3);
    expect(skill).toMatch(/Prompt only/);
    expect(skill).toMatch(/Not built|not built/);
  });
  it('only points to files that exist', () => {
    // docs/wiki/ paths belong to a project that adopts the factory, not to this repository
    const missing = pathsIn(skill).filter(p => !p.startsWith('docs/wiki/') && !fs.existsSync(path.join(root, p.replace(/\*+$/, ''))));
    expect(missing).toEqual([]);
  });
});

describe('where the principles are carried', () => {
  it('the factory guide and the README point to the skill', () => {
    expect(read('.claude', 'CLAUDE.md')).toContain('.claude/skills/principles.md');
    expect(read('README.md')).toContain('.claude/skills/principles.md');
  });
  it('the project CLAUDE.md template turns them into working rules and routing', () => {
    const t = read('templates', 'project', 'CLAUDE.md');
    for (const w of ['People direct, agents execute', 'deep modules', 'small steps', '/grill', '/language', 'Measure the mission', 'assumes about how people work']) {
      expect(t.toLowerCase()).toContain(w.toLowerCase());
    }
  });
  it('seven agents are told to use the project language, and the reviewer to judge avoided words', () => {
    for (const a of ['product-manager', 'analyzer', 'software-architect', 'backend-engineer', 'frontend-engineer', 'customer-support', 'reviewer']) {
      expect(read('.claude', 'agents', `${a}.md`)).toContain('If the input has `language`');
    }
    expect(read('.claude', 'agents', 'reviewer.md')).toContain('languageCheck');
  });
  it('the architect is told to return modules, assumed changes and futures, and builders to work in small steps', () => {
    const architect = read('.claude', 'agents', 'software-architect.md');
    for (const k of ['`modules`', '`assumed_changes`', '`futures`']) expect(architect).toContain(k);
    for (const a of ['backend-engineer', 'frontend-engineer']) expect(read('.claude', 'agents', `${a}.md`)).toContain('Work in small steps');
  });
  it('the reviewer is told to be a sceptic and not to judge by volume, and the tester treats coverage as a floor', () => {
    const reviewer = read('.claude', 'agents', 'reviewer.md');
    expect(reviewer).toContain('Be a sceptic');
    expect(reviewer).toContain('never by volume');
    expect(read('.claude', 'agents', 'automation-tester.md')).toContain('Coverage floor');
  });
  it('the contradictions are written down with the decisions they need', () => {
    const next = read('docs', 'NEXT-CAPABILITIES.md');
    expect(next).toContain('## Principles check');
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'G1', 'T1']) expect(next).toContain(`| ${id} |`);
  });
});
