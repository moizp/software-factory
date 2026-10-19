import * as fs from 'fs';
import * as path from 'path';

/**
 * A project's wiki: the knowledge the next person or agent needs and cannot get from the code, kept as plain markdown
 * in docs/wiki (override with FACTORY_WIKI_DIR). One page per subject. Every page says whether it is current, when it was
 * last checked against what, and the index is generated from the pages so it cannot drift. Everything here is pure except
 * `wikiDir`, `readWiki` and `pageSourcePaths`' callers.
 *
 *   docs/wiki/README.md       the index: purpose, then a table between <!-- wiki:index --> markers
 *   docs/wiki/<area>/<page>.md
 *
 *   # Title
 *
 *   Status: current | draft | deprecated
 *   Last verified: 2026-10-19
 *   Sources: src/auth/; docs/api.md; issue #12
 *
 *   One paragraph saying what this page is for.
 *
 *   ## ...
 */

export const STATUSES = ['current', 'draft', 'deprecated'] as const;
export const INDEX_START = '<!-- wiki:index -->';
export const INDEX_END = '<!-- /wiki:index -->';
export const INDEX_FILE = 'README.md';
export const DEFAULT_STALE_DAYS = 180;
const MAX_LINES = 400;
const SUMMARY = { min: 20, max: 300 };
const ROW_SUMMARY = 160;
const PLACEHOLDER = /<[^>\n]{1,100}>|\b(?:TODO|TBD|lorem ipsum)\b/i;

export interface WikiPage {
  /** Path inside the wiki directory, with forward slashes. */
  path: string;
  title: string;
  status?: string;
  verified?: string;
  sources: string[];
  summary: string;
  lines: number;
  links: string[];
}

export interface WikiIssue { path: string; severity: 'error' | 'warning'; message: string }

const SECRETS: Array<[RegExp, string]> = [
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API secret key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9/+_-]{16,}/i, 'a credential assignment']
];

const stripCode = (md: string): string => md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

// ---- parsing ---------------------------------------------------------------------------------------------------------

export function parsePage(file: string, md: string): WikiPage {
  const body = md.replace(/<!--[\s\S]*?-->/g, '');
  const lines = body.split(/\r?\n/);
  const title = (lines.find(l => /^#\s+\S/.test(l)) ?? '').replace(/^#\s+/, '').trim();
  const firstH2 = lines.findIndex(l => /^##\s/.test(l));
  const head = firstH2 < 0 ? lines : lines.slice(0, firstH2);
  const meta = (key: string): string | undefined => {
    for (const l of head) { const m = new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`, 'i').exec(l); if (m) return m[1]; }
    return undefined;
  };
  const isMeta = (l: string) => /^(Status|Last verified|Sources|Owner)\s*:/i.test(l);
  const after = head.slice(head.findIndex(l => /^#\s+\S/.test(l)) + 1).filter(l => !isMeta(l));
  const para: string[] = [];
  for (const l of after) {
    if (l.trim() === '') { if (para.length) break; continue; }
    if (/^#/.test(l)) break;
    para.push(l.trim());
  }
  const sources = (meta('Sources') ?? '').split(/[;]/).map(s => s.trim()).filter(Boolean);
  const links = [...stripCode(md).matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)].map(m => m[1]);
  return { path: norm(file), title, status: meta('Status')?.toLowerCase(), verified: meta('Last verified'), sources, summary: para.join(' '), lines: lines.length, links };
}

/** Sources that look like repository paths (they contain a slash or a file extension); the rest are issues, people, documents. */
export function pageSourcePaths(page: WikiPage): string[] {
  return page.sources.filter(s => !/\s/.test(s) && !/^(#|https?:)/.test(s) && (s.includes('/') || /\.[A-Za-z0-9]{1,6}$/.test(s)));
}

// ---- index -----------------------------------------------------------------------------------------------------------

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The index table, generated from the pages. The index file itself is not a page. */
export function renderIndex(files: Record<string, string>): string {
  const rows = Object.keys(files).map(norm).filter(p => p !== INDEX_FILE).sort()
    .map(p => parsePage(p, files[p]))
    .map(pg => `| [${cell(pg.title || pg.path)}](${pg.path}) | ${pg.status ?? '?'} | ${cell(clip(pg.summary, ROW_SUMMARY))} |`);
  return ['| Page | Status | What it covers |', '|---|---|---|', ...rows].join('\n');
}

export function indexBlock(readme: string): string | null {
  const a = readme.indexOf(INDEX_START);
  const b = readme.indexOf(INDEX_END);
  return a < 0 || b < a ? null : readme.slice(a + INDEX_START.length, b).trim();
}

/** The index file with its generated table replaced. Throws when the markers are missing. */
export function updateIndex(readme: string, files: Record<string, string>): string {
  const a = readme.indexOf(INDEX_START);
  const b = readme.indexOf(INDEX_END);
  if (a < 0 || b < a) throw new Error(`${INDEX_FILE} needs ${INDEX_START} and ${INDEX_END} around the generated table`);
  return `${readme.slice(0, a + INDEX_START.length)}\n${renderIndex(files)}\n${readme.slice(b)}`;
}

const rowsOf = (table: string): Map<string, string> => new Map(
  table.split('\n').map(l => [/\]\(([^)]+)\)/.exec(l)?.[1], l.trim()] as const).filter((e): e is [string, string] => !!e[0]));

// ---- checking --------------------------------------------------------------------------------------------------------

export interface CheckOptions {
  now?: Date;
  staleDays?: number;
  /** Whether a path that points outside the wiki exists, relative to the wiki directory. Without it such links are not checked. */
  exists?: (relativeToWiki: string) => boolean;
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Everything wrong with the wiki, errors first. `files` maps each page's path inside the wiki directory to its text. */
export function checkWiki(input: Record<string, string>, opts: CheckOptions = {}): WikiIssue[] {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) files[norm(k)] = v;
  const issues: WikiIssue[] = [];
  const add = (p: string, severity: WikiIssue['severity'], message: string) => issues.push({ path: p, severity, message });
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;

  const readme = files[INDEX_FILE];
  if (readme === undefined) add(INDEX_FILE, 'error', `there is no ${INDEX_FILE}: the index every other page is listed in`);
  else {
    const block = indexBlock(readme);
    if (block === null) add(INDEX_FILE, 'error', `${INDEX_FILE} has no ${INDEX_START} ... ${INDEX_END} block for the generated index`);
    else {
      const have = rowsOf(block);
      const want = rowsOf(renderIndex(files));
      const missing = [...want.keys()].filter(k => !have.has(k));
      const extra = [...have.keys()].filter(k => !want.has(k));
      const changed = [...want.keys()].filter(k => have.has(k) && have.get(k) !== want.get(k));
      if (missing.length || extra.length || changed.length) {
        const parts = [missing.length ? `missing ${missing.join(', ')}` : '', extra.length ? `lists pages that do not exist: ${extra.join(', ')}` : '', changed.length ? `out of date for ${changed.join(', ')}` : ''].filter(Boolean);
        add(INDEX_FILE, 'error', `the index is out of date (${parts.join('; ')}): run npm run wiki -- index --write`);
      }
    }
  }

  const titles = new Map<string, string>();
  for (const file of Object.keys(files).sort()) {
    if (file === INDEX_FILE) continue;
    const md = files[file];
    const pg = parsePage(file, md);
    const current = pg.status === 'current';

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\.md$/.test(file)) add(file, 'warning', 'file names are lower-case words joined by hyphens (kebab-case)');
    if (!pg.title) add(file, 'error', 'the page has no "# Title" line');
    else if (titles.has(pg.title.toLowerCase())) add(file, 'warning', `the title "${pg.title}" is also used by ${titles.get(pg.title.toLowerCase())}`);
    else titles.set(pg.title.toLowerCase(), file);

    if (!pg.status) add(file, 'error', `the page has no "Status:" line (${STATUSES.join(', ')})`);
    else if (!(STATUSES as readonly string[]).includes(pg.status)) add(file, 'error', `Status "${pg.status}" is not one of ${STATUSES.join(', ')}`);

    if (!isDate(pg.verified)) add(file, 'error', 'the page has no valid "Last verified: YYYY-MM-DD" line');
    else {
      const age = Math.floor((now.getTime() - Date.parse(`${pg.verified}T00:00:00Z`)) / 86_400_000);
      if (age < -1) add(file, 'error', `Last verified ${pg.verified} is in the future`);
      else if (current && age > staleDays) add(file, 'warning', `last verified ${age} days ago (over ${staleDays}): check it against its sources and update the date, or mark it deprecated`);
    }
    if (current && pg.sources.length === 0) add(file, 'warning', 'a current page with no "Sources:" cannot be re-verified: name the code, document, issue or person the facts come from');

    if (pg.summary.length < SUMMARY.min) add(file, 'error', `the paragraph under the title (what this page is for) is missing or shorter than ${SUMMARY.min} characters`);
    else if (pg.summary.length > SUMMARY.max) add(file, 'warning', `the opening paragraph is over ${SUMMARY.max} characters: it is the index summary, keep it to what the page covers`);
    if (current && pg.lines >= 20 && pg.links.length === 0) add(file, 'warning', 'a current page of this length links to nothing: a knowledge repository is hyperlinked, so link the related pages, the code, the decision or the issue it rests on');
    if (pg.lines > MAX_LINES) add(file, 'warning', `${pg.lines} lines: split it, one page per subject`);

    if (current && PLACEHOLDER.test(stripCode(md))) add(file, 'error', 'a current page still has template placeholders (<...>, TODO or TBD): finish it or mark it draft');

    for (const [re, what] of SECRETS) if (re.test(md)) add(file, 'error', `the page appears to contain ${what}: remove it and rotate the secret, the wiki is read by people and agents`);

    if (/^decisions\//.test(file)) {
      if (!/^decisions\/\d{4}-[a-z0-9-]+\.md$/.test(file)) add(file, 'warning', 'decision records are named decisions/NNNN-short-title.md');
      for (const h of ['Context', 'Decision', 'Consequences']) if (!new RegExp(`^##\\s+${h}\\b`, 'mi').test(md)) add(file, 'warning', `a decision record has a "## ${h}" section`);
    }

    for (const link of pg.links) {
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURI(link.split('#')[0])));
      if (!link.split('#')[0]) continue;
      if (target.startsWith('..')) { if (opts.exists && !opts.exists(target)) add(file, 'error', `broken link: ${link}`); }
      else if (!(target in files) && !(opts.exists?.(target))) add(file, 'error', `broken link: ${link}`);
    }
  }
  return issues.sort((a, b) => (a.severity === b.severity ? a.path.localeCompare(b.path) : a.severity === 'error' ? -1 : 1));
}

// ---- scaffolding -----------------------------------------------------------------------------------------------------

export function scaffold(title: string, today: string, status: 'draft' | 'current' = 'draft'): string {
  return [
    `# ${title}`,
    '',
    `Status: ${status}`,
    `Last verified: ${today}`,
    'Sources: <the code, document, issue or person these facts come from>',
    '',
    `<One or two sentences on what this page covers and who needs it.>`,
    '',
    '## <First heading>',
    '',
    '<Facts, not history. Link to the code or document for detail instead of copying it.>',
    ''
  ].join('\n');
}

// ---- reading ---------------------------------------------------------------------------------------------------------

export function wikiDir(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(cwd, env.FACTORY_WIKI_DIR || path.join('docs', 'wiki'));
}

export function staleDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.FACTORY_WIKI_STALE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_DAYS;
}

/** Every markdown file under the wiki directory, keyed by its path inside it. */
export function readWiki(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.')) walk(p); }
      else if (e.name.endsWith('.md')) out[norm(path.relative(dir, p))] = fs.readFileSync(p, 'utf-8');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
