import { uiFiles } from '../evidence/ui-paths';
import { Tier } from '../review/types';
import { section } from './evidence';

/**
 * Gates for interface work (UI-RULES.md, .claude/skills/layout-guard.md): a layout fix must show the guard failing on the
 * old code and passing on the fix; limits and tests may not be relaxed to get there; and a few orchestration lessons
 * (identity, scratch files, hooks that change the author) are checked from the diff, not from anyone's say-so.
 */

export interface LayoutIssue {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

const LAYOUT_WORDS = /\b(layout|spacing|overlap\w*|overflow\w*|crowd\w*|gap|padding|margin|clip\w*|truncat\w*|alignment|focus[- ]ring|squash\w*)\b/i;

/** A change that fixes how things sit on the page: a fix/ branch, or layout words in the title or branch, that touches interface files. */
export function isLayoutFix(branch: string, title: string, files: string[]): boolean {
  if (uiFiles(files).length === 0) return false;
  return /^fix\//.test(branch) || LAYOUT_WORDS.test(title) || LAYOUT_WORDS.test(branch);
}

const NOT_APPLICABLE = /^\s*not applicable\s*:\s*(.{10,})$/im;

/** Needs a "Layout proof" section where the guard FAILS on the base and PASSES on the head (output of `npm run layout:prove`). */
export function checkLayoutProof(body: string, input: { branch: string; title: string; files: string[]; tier: Tier }): LayoutIssue[] {
  if (!isLayoutFix(input.branch, input.title, input.files)) return [];
  const text = section(body, /^layout proof\b/i);
  if (text && NOT_APPLICABLE.test(text)) return [];
  const base = text && /^\s*base\b.*\bFAIL\b/im.test(text);
  const head = text && /^\s*head\b.*\bPASS\b/im.test(text);
  if (base && head && !/not proven/i.test(text ?? '')) return [];
  const why = !text
    ? 'the body has no "Layout proof" section'
    : !base
      ? 'the proof does not show the guard FAILING on the base (it must fail on the old code, or it does not show the defect)'
      : 'the proof does not show the guard PASSING on the head';
  return [{
    severity: 'error',
    rule: 'layout-proof-missing',
    message: `this looks like a layout fix and ${why}. Run \`npm run layout:prove -- --base origin/main\` and paste its output under "Layout proof"; no passing proof, no merge. Or write "Not applicable: <reason>" there`
  }];
}

// ---- diff review: no relaxing the guard to get green ----

interface Hunk { file: string; removed: string[]; added: string[] }

function hunks(diff: string): Hunk[] {
  const out: Hunk[] = [];
  let file = '';
  let cur: Hunk | null = null;
  for (const line of diff.split('\n')) {
    const f = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (f) { file = f[1]; continue; }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('@@')) { cur = { file, removed: [], added: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (line.startsWith('-')) cur.removed.push(line.slice(1));
    else if (line.startsWith('+')) cur.added.push(line.slice(1));
  }
  return out;
}

const GUARD_FILE = /(^|\/)(layout-guard\.cjs|layout-guard\.config\.json|UI-RULES\.md)$/;
const TEST_FILE = /(\.|\/)(test|spec)\.[tj]sx?$|(^|\/)__tests__\//;
const LIMIT_KEYS = ['controlGap', 'labelGap', 'labelPadding', 'touch'];
const LIST_KEYS = ['widths', 'themes', 'textSizes'];

const numberFor = (lines: string[], key: string): number | undefined => {
  for (const l of lines) { const m = new RegExp(`["']?\\b${key}\\b["']?\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`).exec(l); if (m) return Number(m[1]); }
  return undefined;
};
const listFor = (lines: string[], key: string): number | undefined => {
  for (const l of lines) { const m = new RegExp(`["']?\\b${key}\\b["']?\\s*[:=]\\s*\\[([^\\]]*)\\]`).exec(l); if (m) return m[1].split(',').filter(s => s.trim()).length; }
  return undefined;
};
/** True when the pattern matches in code, not inside a string literal (a line that only quotes it, as a test of this gate does). */
const inCode = (line: string, re: RegExp): boolean => {
  const m = re.exec(line);
  if (!m) return false;
  const before = line.slice(0, m.index).replace(/\\./g, '');
  return !['\'', '"', '`'].some(q => (before.split(q).length - 1) % 2 === 1);
};
const count = (lines: string[], re: RegExp): number => lines.filter(l => re.test(l)).length;

/** Reads a diff (`git diff --unified=0 base...head`) for the ways a fix gets green by weakening the check instead of the page. */
export function reviewLayoutDiff(diff: string): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const add = (rule: string, message: string) => { if (!issues.some(i => i.message === message)) issues.push({ severity: 'error', rule, message }); };
  const all = hunks(diff);

  for (const h of all) {
    const where = h.file;
    if (GUARD_FILE.test(where)) {
      for (const k of LIMIT_KEYS) {
        const was = numberFor(h.removed, k), now = numberFor(h.added, k);
        if (was !== undefined && now !== undefined && now < was) add('limit-relaxed', `${where}: the limit "${k}" went from ${was} to ${now}. Limits can only be tightened; fix the page, not the limit`);
        if (was !== undefined && now === undefined && !/"limits"/.test(h.added.join('\n'))) add('limit-relaxed', `${where}: the limit "${k}" (${was}) was removed`);
      }
      for (const k of LIST_KEYS) {
        const was = listFor(h.removed, k), now = listFor(h.added, k);
        if (was !== undefined && now !== undefined && now < was) add('matrix-shrunk', `${where}: "${k}" went from ${was} entries to ${now}. Every width, theme and text size stays in the matrix`);
      }
      if (h.added.some(l => /readySelector["']?\s*:\s*false/.test(l))) add('guard-weakened', `${where}: "readySelector": false makes the guard measure before the page hydrates; wait on state instead`);
    }
    if (GUARD_FILE.test(where) || TEST_FILE.test(where)) {
      if (h.added.some(l => inCode(l, /\.(skip|fixme)\(|\bxit\(|\bxdescribe\(|\btest\.only\(|\bit\.only\(|\bdescribe\.only\(/))) add('test-skipped', `${where}: a test or row is skipped or focused (skip, fixme, only)`);
      if (h.added.some(l => inCode(l, /\bretries\s*:|\bwaitForTimeout\(|\bsleep\(|new Promise\([^)]*setTimeout/))) add('blind-retry', `${where}: a retry or a fixed sleep was added; wait on state (hydration, fonts, a rendered element) instead`);
    }
  }

  // tests and the guard may not lose assertions or rows overall
  const byFile = new Map<string, Hunk[]>();
  for (const h of all) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
  for (const [file, hs] of byFile) {
    const removed = hs.flatMap(h => h.removed), added = hs.flatMap(h => h.added);
    if (TEST_FILE.test(file)) {
      const lost = count(removed, /\bexpect\(|\bassert\w*\(/) - count(added, /\bexpect\(|\bassert\w*\(/);
      if (lost > 0) add('test-weakened', `${file}: ${lost} more assertion(s) removed than added. A fix may not weaken an existing test`);
    }
    const rows = count(removed, /data-layout-row/) - count(added, /data-layout-row/);
    if (rows > 0) add('row-skipped', `${file}: ${rows} row(s) lost their data-layout-row mark, so the guard no longer reads them`);
    const worst = count(removed, /data-guard-worst/) - count(added, /data-guard-worst/);
    if (worst > 0) add('worst-case-removed', `${file}: ${worst} data-guard-worst mark(s) removed; the worst-case content is no longer tried`);
    const fallback = count(removed, /compat-fallback:/) - count(added, /compat-fallback:/);
    if (fallback > 0) add('fallback-removed', `${file}: ${fallback} compat-fallback declaration(s) removed`);
  }

  // the focus ring stays (R5): removing the outline needs a ring or shadow in its place
  for (const h of all.filter(x => !TEST_FILE.test(x.file))) {
    const hid = h.added.filter(l => /\boutline-none\b|\boutline-0\b|outline\s*:\s*(none|0)\b/.test(l));
    if (hid.length && !h.added.some(l => /\bring-|box-shadow|focus-visible:outline-[1-9]|outline-offset|outline:\s*[1-9]/.test(l))) {
      add('focus-ring-removed', `${h.file}: an outline is turned off with no ring in its place. The focus ring stays (R5); make room for it instead`);
    }
  }
  return issues;
}

// ---- hooks that change the author ----

const HOOK_FILE = /(^|\/)(\.githooks|\.husky|hooks)\//;
const AUTHOR_CHANGE = /--author\b|--reset-author|GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)|filter-branch|filter-repo|commit-tree|git config(?: --\w+)* user\.(name|email)/;

export function checkAuthorHooks(diff: string): LayoutIssue[] {
  return hunks(diff)
    .filter(h => HOOK_FILE.test(h.file) && h.added.some(l => AUTHOR_CHANGE.test(l)))
    .map(h => ({ severity: 'error' as const, rule: 'hook-changes-author', message: `${h.file}: a hook that sets or changes the commit author or committer is not accepted. Commit as the identity the owner specified` }));
}

// ---- identity ----

export interface CommitIdentity {
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  subject: string;
}

export interface Identity { name: string; email: string }

export function parseIdentity(text: string | undefined): Identity | null {
  const m = /^\s*(.+?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(text ?? '');
  return m ? { name: m[1], email: m[2] } : null;
}

/** Every commit's author and committer is the identity the owner specified. Not configured: nothing is assumed, nothing is checked. */
export function checkIdentity(commits: CommitIdentity[], expected: Identity | null): LayoutIssue[] {
  if (!expected) return [];
  const off = commits.filter(c => ![c.authorName === expected.name && c.authorEmail === expected.email, c.committerName === expected.name && c.committerEmail === expected.email].every(Boolean));
  return off.map(c => ({
    severity: 'error' as const,
    rule: 'identity-mismatch',
    message: `commit "${c.subject.slice(0, 60)}" is by ${c.authorName} <${c.authorEmail}> and committed by ${c.committerName} <${c.committerEmail}>; the owner specified ${expected.name} <${expected.email}> for both`
  }));
}

// ---- scratch and log files ----

const SCRATCH = [
  /\.log$/, /(^|\/)(tmp|temp|scratch|\.scratch)\//, /\.(orig|rej|bak|swp|tmp)$/, /(^|\/)nohup\.out$/, /(^|\/)\.DS_Store$/,
  /(^|\/)core\.\d+$/, /(^|\/)(playwright-report|test-results)\//, /(^|\/)layout-proof[^/]*\.(json|md)$/
];

export function checkScratchFiles(files: string[]): LayoutIssue[] {
  return files.filter(f => SCRATCH.some(r => r.test(f))).map(f => ({
    severity: 'error' as const,
    rule: 'scratch-file',
    message: `${f} looks like a scratch, log or output file; keep it out of the repository (the layout proof goes in the pull request text, not in a file)`
  }));
}
