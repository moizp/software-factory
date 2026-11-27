import * as fs from 'fs';
import * as path from 'path';

/**
 * Standing rules for web interfaces (UI-RULES.md): a project's own file, or the factory's default. The rules are
 * handed to the agents that build and judge an interface, so they are always in front of them; agents never read the
 * file themselves. Each rule is one line "- R1: text" and each checklist item "1. text".
 */

export interface UiRules {
  source: 'project' | 'factory';
  file: string;
  rules: Array<{ id: string; text: string }>;
  checklist: string[];
}

export const DEFAULT_FILE = path.join(__dirname, '..', 'templates', 'web-app', 'UI-RULES.md');

export function parseUiRules(md: string): { ok: true; rules: UiRules['rules']; checklist: string[] } | { ok: false; error: string } {
  const rules = [...md.matchAll(/^- (R\d+): (.+)$/gm)].map(m => ({ id: m[1], text: m[2].trim() }));
  if (rules.length === 0) return { ok: false, error: 'no rules found: each rule is a line like "- R1: Keep at least 6 px between controls."' };
  const ids = rules.map(r => r.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: `a rule id is used twice (${ids.join(', ')})` };
  const after = md.split(/^## Checklist.*$/m)[1] ?? '';
  const checklist = [...after.matchAll(/^\d+\. (.+)$/gm)].map(m => m[1].trim());
  return { ok: true, rules, checklist };
}

/** The project's UI-RULES.md, or the factory's own. Null when the file is unusable. */
export function loadUiRules(cwd: string = process.cwd()): { rules: UiRules } | { error: string } {
  const own = path.join(cwd, 'UI-RULES.md');
  const file = fs.existsSync(own) ? own : DEFAULT_FILE;
  const parsed = parseUiRules(fs.readFileSync(file, 'utf-8'));
  if (!parsed.ok) return { error: `${file}: ${parsed.error}` };
  return { rules: { source: file === own ? 'project' : 'factory', file, rules: parsed.rules, checklist: parsed.checklist } };
}

export function uiRulesForAgents(r: UiRules): Record<string, unknown> {
  return { rules: r.rules.map(x => `${x.id}: ${x.text}`), checklist: r.checklist };
}

const MIN = 10;

/**
 * The frontend engineer says how its work keeps the UI rules: which rows of controls it marked for the guard, what
 * worst-case content it tried, how it made room (Tailwind first), and that it left every limit alone.
 */
export function layoutCheckProblems(response: Record<string, unknown>): string[] {
  const r = response.layout_check;
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return ['layout_check is missing. The project has standing UI rules: return layout_check with rows (names of the rows of controls marked data-layout-row; a list, empty when the work adds none), worst_case (the longest content tried), spacing (how room was made, with Tailwind classes first) and limits_changed (false)'];
  }
  const o = r as Record<string, unknown>;
  const problems: string[] = [];
  const rows = Array.isArray(o.rows) ? o.rows : null;
  if (!rows || !rows.every(x => typeof x === 'string' && x.trim())) problems.push('layout_check.rows must be a list of row names (empty when the work adds no row of controls)');
  if (rows && rows.length > 0) {
    if (typeof o.worst_case !== 'string' || o.worst_case.trim().length < MIN) problems.push('layout_check.worst_case must name the longest content tried for those rows (3 and 4 digit numbers, the longest label)');
    if (typeof o.spacing !== 'string' || o.spacing.trim().length < MIN) problems.push('layout_check.spacing must say how room was made, with Tailwind classes (gap-2, px-2, min-w-[10ch], flex-wrap) before any custom CSS');
  }
  if (o.limits_changed !== false) problems.push('layout_check.limits_changed must be false: a limit is never lowered, a row skipped or a test weakened to make a check pass');
  return problems;
}
