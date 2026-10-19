import * as fs from 'fs';
import * as path from 'path';

/**
 * A project's CLAUDE.md, the file Claude Code reads at the start of every interactive session. It has a fixed shape so
 * it can be written, checked and kept short: five sections of succinct bullets that point to things and do not hold them.
 *
 *   # <Project>             one line saying what it is
 *   ## How this repo works
 *   ## Skill routing
 *   ## Knowledge architecture
 *   ## Project lifecycle
 *   ## Working rules        names the mission, goals, character, and look and feel
 */

export const SECTIONS = ['How this repo works', 'Skill routing', 'Knowledge architecture', 'Project lifecycle', 'Working rules'] as const;
export const BULLETS = { min: 3, max: 15 };
export const MAX_BULLET = 240;
export const MAX_LINES = 120;
const PLACEHOLDER = /<[^>\n]{1,100}>|\b(?:TODO|TBD|lorem ipsum)\b/i;

export interface ClaudeMdIssue { severity: 'error' | 'warning'; message: string }

const strip = (md: string): string => md.replace(/<!--[\s\S]*?-->/g, '');

/** What each section must mention, so the rules the factory depends on cannot be dropped by accident. */
const MUST_MENTION: Array<{ section: (typeof SECTIONS)[number]; pattern: RegExp; what: string }> = [
  { section: 'Knowledge architecture', pattern: /docs\/wiki/, what: 'the wiki (docs/wiki)' },
  { section: 'Working rules', pattern: /\bmission\b/i, what: 'the mission' },
  { section: 'Working rules', pattern: /\bgoals?\b/i, what: 'goals' },
  { section: 'Working rules', pattern: /\bcharacter\b/i, what: 'the character' },
  { section: 'Working rules', pattern: /look and feel|lookfeel/i, what: 'the look and feel' }
];

export function sectionsOf(md: string): Array<{ title: string; lines: string[] }> {
  const out: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;
  let fenced = false;
  for (const line of strip(md).split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = !fenced && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) { current = { title: m[1], lines: [] }; out.push(current); }
    else if (current) current.lines.push(line);
  }
  return out;
}

/** Repository paths named in backticks: they contain a slash or end in .md, with no spaces or placeholders. */
export function pathsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/`([^`\s<>]+)`/g)].map(m => m[1])
    .filter(p => (p.includes('/') || p.endsWith('.md')) && !/^(\/|~|https?:|\.\.)/.test(p) && !/[*{}$|]/.test(p) && !/^(npm|git|node)\b/.test(p)))];
}

export interface CheckOptions {
  /** Whether a path named in the file exists, relative to the project root. Without it paths are not checked. */
  exists?: (p: string) => boolean;
}

/** Everything wrong with the file, errors first. */
export function checkClaudeMd(md: string, opts: CheckOptions = {}): ClaudeMdIssue[] {
  const issues: ClaudeMdIssue[] = [];
  const add = (severity: ClaudeMdIssue['severity'], message: string) => issues.push({ severity, message });
  const body = strip(md);
  const lines = body.split(/\r?\n/);

  if (!/^#\s+\S/m.test(body)) add('error', 'there is no "# <Project name>" title');
  if (lines.length > MAX_LINES) add('warning', `${lines.length} lines: this file is read at the start of every session, keep it under ${MAX_LINES} and move detail to the wiki`);

  const found = sectionsOf(md);
  const titles = found.map(s => s.title.toLowerCase());
  for (const name of SECTIONS) if (!titles.includes(name.toLowerCase())) add('error', `there is no "## ${name}" section`);
  const order = SECTIONS.map(s => titles.indexOf(s.toLowerCase())).filter(i => i >= 0);
  if (order.some((v, i) => i > 0 && v < order[i - 1])) add('warning', `the sections are not in the usual order (${SECTIONS.join(', ')})`);
  for (const s of found) if (!SECTIONS.some(n => n.toLowerCase() === s.title.toLowerCase())) add('warning', `"## ${s.title}" is not one of the five sections: put it in the wiki or in the section it belongs to`);

  for (const name of SECTIONS) {
    const section = found.find(s => s.title.toLowerCase() === name.toLowerCase());
    if (!section) continue;
    const text = section.lines.filter(l => l.trim() !== '');
    const bullets = text.filter(l => /^\s*[-*]\s+\S/.test(l));
    const other = text.filter(l => !/^\s*[-*]\s+\S/.test(l));
    if (other.length) add('error', `${name}: only bullet points belong here, found "${other[0].trim().slice(0, 50)}"`);
    if (bullets.length < BULLETS.min || bullets.length > BULLETS.max) add('error', `${name}: needs ${BULLETS.min} to ${BULLETS.max} bullets, found ${bullets.length}`);
    for (const b of bullets) if (b.trim().length > MAX_BULLET) add('error', `${name}: a bullet is over ${MAX_BULLET} characters ("${b.trim().slice(2, 40)}..."): split it or move the detail to the wiki`);
    if (name === 'Skill routing') {
      for (const b of bullets) if (!/`\/[a-z][a-z-]*`|\.claude\/skills\//.test(b)) add('warning', `Skill routing: "${b.trim().slice(2, 50)}..." names no command or skill`);
    }
    for (const m of MUST_MENTION.filter(x => x.section === name)) {
      if (!m.pattern.test(text.join('\n'))) add('error', `${name}: must mention ${m.what}`);
    }
  }

  if (PLACEHOLDER.test(body.replace(/```[\s\S]*?```/g, ''))) add('error', 'the file still contains template placeholders (<...>, TODO or TBD)');

  if (opts.exists) {
    for (const p of pathsIn(body)) if (!opts.exists(p)) add('warning', `\`${p}\` is named here but does not exist`);
  }
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

export function claudeMdFile(cwd: string = process.cwd()): string {
  return path.resolve(cwd, 'CLAUDE.md');
}

export function readClaudeMd(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}
