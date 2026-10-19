import * as fs from 'fs';
import * as path from 'path';
import { parsePage } from './wiki';

/**
 * A project's ubiquitous language: the words people, domain experts and agents all use for the project's things, each with
 * one meaning and the synonyms nobody uses for it. It lives in the wiki glossary (docs/wiki/glossary.md) as a table under
 * "## Terms", so there is one glossary, not two. Only a page whose Status is "current" is used; a draft is a note, not a rule.
 *
 *   | Term | Means | Avoid | Not to be confused with |
 *   |---|---|---|---|
 *   | Invoice | A request for payment sent to a customer | bill, tab | Receipt |
 *
 * Everything here is pure except `loadLanguage`.
 */

export interface Term { term: string; means: string; avoid: string[]; notConfusedWith?: string }

export type LanguageParse =
  | { ok: true; terms: Term[]; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export const MIN_TERMS = 3;
export const MAX_TERMS = 80;
/** Terms handed to agents: the first of the glossary, so a long one stays inside the context budget. */
export const AGENT_TERMS = 40;
const MEANS = { min: 10, max: 300 };
const PLACEHOLDER = /<[^>\n]{1,100}>|\b(?:TODO|TBD|lorem ipsum)\b/i;

const strip = (md: string): string => md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '');
const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
const key = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** "invoices" and "invoice" are the same term. */
const stem = (s: string): string => key(s).replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1');

/** The table rows under "## Terms" (or the first table with Term and Means columns). */
function termRows(md: string): { header: string[]; rows: string[][] } | null {
  const lines = strip(md).split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+terms\b/i.test(l));
  const scope = start >= 0 ? lines.slice(start + 1) : lines;
  const end = scope.findIndex((l, i) => i > 0 && /^##\s/.test(l));
  const body = end >= 0 ? scope.slice(0, end) : scope;
  const tableLines = body.filter(l => /^\s*\|/.test(l));
  for (let i = 0; i < tableLines.length - 1; i++) {
    const header = cells(tableLines[i]).map(key);
    if (header.includes('term') && header.includes('means') && /^\s*\|?[\s:|-]+\|?\s*$/.test(tableLines[i + 1])) {
      return { header, rows: tableLines.slice(i + 2).map(cells) };
    }
  }
  return null;
}

/** Reads the glossary's terms. Errors mean agents must not be given it; warnings are advice. */
export function parseLanguage(md: string): LanguageParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const table = termRows(md);
  if (!table) return { ok: false, errors: ['there is no "## Terms" table with a Term column and a Means column'], warnings };

  const col = (name: string): number => table.header.findIndex(h => h === name || (name === 'not to be confused with' && h.startsWith('not')));
  const [iTerm, iMeans, iAvoid, iNot] = [col('term'), col('means'), col('avoid'), col('not to be confused with')];
  const terms: Term[] = [];
  const seen = new Map<string, string>();
  for (const row of table.rows) {
    const term = row[iTerm] ?? '';
    const means = row[iMeans] ?? '';
    if (!term && !means) continue;
    if (!term || term.length > 60) { errors.push(`a term is empty or longer than 60 characters ("${term.slice(0, 30)}")`); continue; }
    if (seen.has(stem(term))) { errors.push(`"${term}" is defined twice (also as "${seen.get(stem(term))}")`); continue; }
    seen.set(stem(term), term);
    if (means.length < MEANS.min) errors.push(`"${term}" has no meaning, or one too short to decide anything`);
    else if (means.length > MEANS.max) errors.push(`the meaning of "${term}" is longer than ${MEANS.max} characters: say it once, briefly, and link to the page that explains it`);
    const avoid = iAvoid >= 0 ? (row[iAvoid] ?? '').split(/[,;]/).map(a => a.trim()).filter(Boolean) : [];
    if (avoid.some(a => a.length > 40)) errors.push(`"${term}": an avoid word is longer than 40 characters`);
    terms.push({ term, means, avoid, ...(iNot >= 0 && row[iNot] ? { notConfusedWith: row[iNot] } : {}) });
  }

  if (terms.length < MIN_TERMS) errors.push(`the glossary needs at least ${MIN_TERMS} terms, found ${terms.length}`);
  if (terms.length > MAX_TERMS) errors.push(`the glossary has ${terms.length} terms (limit ${MAX_TERMS}): one project, one vocabulary; move the long tail into the page that uses it`);

  const termKeys = new Set(terms.map(t => stem(t.term)));
  const owner = new Map<string, string>();
  for (const t of terms) {
    for (const a of t.avoid) {
      if (termKeys.has(stem(a))) errors.push(`"${a}" is both a term and a word to avoid for "${t.term}": pick one meaning`);
      else if (owner.has(stem(a)) && owner.get(stem(a)) !== t.term) errors.push(`"${a}" is to be avoided for both "${owner.get(stem(a))}" and "${t.term}": it would not say which to use`);
      else owner.set(stem(a), t.term);
    }
    if (t.avoid.length === 0) warnings.push(`"${t.term}" lists no words to avoid: if nobody confuses it with a synonym, that is fine; if they do, name the synonym`);
  }
  if (terms.length > 0 && terms.every(t => t.avoid.length === 0)) warnings.push('no term lists a word to avoid, so nothing can be checked for drift; add the synonyms people actually use');

  if (PLACEHOLDER.test(strip(md))) errors.push('the file still contains template placeholders (<...>, TODO or TBD)');

  return errors.length ? { ok: false, errors, warnings } : { ok: true, terms, warnings };
}

// ---- for agents ------------------------------------------------------------------------------------------------------

/** What agents receive: each term, its meaning and the words not to use for it. */
export function languageForAgents(terms: Term[]): Array<{ term: string; means: string; avoid?: string[] }> {
  return terms.slice(0, AGENT_TERMS).map(t => ({ term: t.term, means: t.means, ...(t.avoid.length ? { avoid: t.avoid } : {}) }));
}

export function renderLanguageLine(terms: Term[]): string {
  return `${terms.length} term${terms.length === 1 ? '' : 's'}: ${terms.slice(0, 5).map(t => t.term).join(', ')}${terms.length > 5 ? ', ...' : ''}`;
}

// ---- drift -----------------------------------------------------------------------------------------------------------

export interface LanguageHit { phase: string; avoid: string; use: string; count: number }

/** Every string value in a JSON-like structure (keys are not words anyone reads). */
export function stringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => stringValues(v, out));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(v => stringValues(v, out));
  return out;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the work uses a word the glossary says to avoid. `outputs` maps a phase to what it returned. The reviewer gets this
 * as a list to judge, not as a failure: a word can be right in quoted text or a third-party name.
 */
export function languageHits(outputs: Record<string, unknown>, terms: Term[], limit = 30): LanguageHit[] {
  const hits: LanguageHit[] = [];
  for (const [phase, output] of Object.entries(outputs)) {
    const text = stringValues(output).join('\n');
    for (const t of terms) {
      for (const a of t.avoid) {
        const count = (text.match(new RegExp(`(?<![A-Za-z0-9_])${escape(a)}(?![A-Za-z0-9_])`, 'gi')) ?? []).length;
        if (count > 0) hits.push({ phase, avoid: a, use: t.term, count });
      }
    }
  }
  return hits.sort((a, b) => b.count - a.count || a.phase.localeCompare(b.phase)).slice(0, limit);
}

// ---- loading ---------------------------------------------------------------------------------------------------------

export type LanguageLoad =
  | { found: false }
  | { found: true; file: string; skipped: string }
  | { found: true; file: string; result: LanguageParse };

export function languageFile(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(cwd, env.FACTORY_LANGUAGE_FILE || path.join('docs', 'wiki', 'glossary.md'));
}

export function requireLanguage(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true)$/i.test(env.FACTORY_REQUIRE_LANGUAGE ?? '');
}

/** A glossary whose Status is not "current" is skipped with a reason: only a verified glossary is a rule. */
export function loadLanguage(file: string = languageFile()): LanguageLoad {
  if (!fs.existsSync(file)) return { found: false };
  const md = fs.readFileSync(file, 'utf-8');
  const status = parsePage(path.basename(file), md).status;
  if (status !== 'current') return { found: true, file, skipped: `its Status is "${status ?? 'missing'}", not "current"` };
  return { found: true, file, result: parseLanguage(md) };
}
