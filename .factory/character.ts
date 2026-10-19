import * as fs from 'fs';
import * as path from 'path';
import { Archetype, findArchetype } from './character-catalogue';
import type { Mission } from './mission';

/**
 * A project's character, declared in CHARACTER.md: who the product is, as a someone. Look and feel decides how it looks
 * and sounds; character decides how it behaves toward a person, above all when things are not going well. It is chosen
 * against the mission, before the look and feel, and the look and feel's tone must agree with it. Everything here is pure
 * except `loadCharacter`.
 *
 *   # Character
 *   ## Archetype       Primary, Secondary (optional), Why (cites BCn / Gn)
 *   ## Traits          3 to 5 lines: "Warm, not chatty: how it shows"
 *   ## Values          2 to 4 lines: "Clarity over cleverness: what it means in practice"
 *   ## Relationship    Role, Stance, Address
 *   ## Moments         First meeting, Success, User mistake, Our failure, Saying no (and optionally Waiting, Leaving)
 *   ## Boundaries      Never (two or more, separated by semicolons), Humour (none, or where)
 */

export interface Trait { is: string; isNot: string; shows?: string }
export interface CharacterValue { prefers: string; over: string; means?: string }

export interface Character {
  archetype: { primary: string; secondary?: string; why: string };
  traits: Trait[];
  values: CharacterValue[];
  relationship: { role: string; stance: string; address: string };
  moments: { firstMeeting: string; success: string; userMistake: string; ourFailure: string; sayingNo: string; waiting?: string; leaving?: string };
  boundaries: { never: string; humour: string };
}

export type CharacterParse =
  | { ok: true; character: Character; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const MIN = 8;
const MAX = 500;
const PLACEHOLDER = /<[^>\n]{1,100}>|\b(?:TODO|TBD|lorem ipsum)\b/i;
const TRAITS = { min: 3, max: 5 };
const VALUES = { min: 2, max: 4 };

function sectionsOf(md: string): Array<{ title: string; lines: string[] }> {
  const out: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;
  let fenced = false;
  for (const line of md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = !fenced && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) { current = { title: m[1], lines: [] }; out.push(current); }
    else if (current) current.lines.push(line);
  }
  return out;
}

function keyed(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of lines) {
    const m = /^\s*[-*]\s+\*{0,2}([A-Za-z][A-Za-z ]*?)\*{0,2}\s*:\s*(.+?)\s*$/.exec(l);
    if (m) out.set(m[1].toLowerCase(), m[2]);
  }
  return out;
}

const bullets = (lines: string[]): string[] => lines.map(l => /^\s*[-*]\s+(.+?)\s*$/.exec(l)?.[1]).filter((x): x is string => !!x);

/** "Warm, not chatty: replies in one or two lines" */
export function parseTrait(line: string): Trait | null {
  const m = /^(.{2,60}?),\s*not\s+(.{2,60}?)(?::\s+(.+))?$/i.exec(line.trim());
  return m ? { is: m[1].trim(), isNot: m[2].trim(), ...(m[3] ? { shows: m[3].trim() } : {}) } : null;
}

/** "Clarity over cleverness: we explain before we ask" */
export function parseValue(line: string): CharacterValue | null {
  const m = /^(.{2,60}?)\s+over\s+(.{2,60}?)(?::\s+(.+))?$/i.exec(line.trim());
  return m ? { prefers: m[1].trim(), over: m[2].trim(), ...(m[3] ? { means: m[3].trim() } : {}) } : null;
}

interface Field { key: string; prop: string; required: boolean; name?: boolean; min?: number }
const f = (key: string, prop: string, required = true, extra: Partial<Field> = {}): Field => ({ key, prop, required, ...extra });

const KEYED: Array<{ title: RegExp; label: string; prop: string; fields: Field[] }> = [
  { title: /^archetype$/i, label: 'Archetype', prop: 'archetype', fields: [f('Primary', 'primary', true, { name: true }), f('Secondary', 'secondary', false, { name: true }), f('Why', 'why')] },
  { title: /^relationship$/i, label: 'Relationship', prop: 'relationship', fields: [f('Role', 'role'), f('Stance', 'stance'), f('Address', 'address')] },
  { title: /^moments$/i, label: 'Moments', prop: 'moments', fields: [
    f('First meeting', 'firstMeeting'), f('Success', 'success'), f('User mistake', 'userMistake'), f('Our failure', 'ourFailure'),
    f('Saying no', 'sayingNo'), f('Waiting', 'waiting', false), f('Leaving', 'leaving', false)] },
  { title: /^boundaries$/i, label: 'Boundaries', prop: 'boundaries', fields: [f('Never', 'never'), f('Humour', 'humour', true, { min: 4 })] }
];

/**
 * Reads CHARACTER.md. Errors mean agents must not be given it; warnings are advice. Pass the project's mission and the
 * "Why" must cite at least one of its behaviour changes (or goals), and only ids it has.
 */
export function parseCharacter(md: string, mission?: Mission): CharacterParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const found = sectionsOf(md);
  const out: Record<string, any> = {};

  for (const spec of KEYED) {
    const section = found.find(s => spec.title.test(s.title));
    if (!section) { errors.push(`there is no "## ${spec.label}" section`); continue; }
    const values = keyed(section.lines);
    const obj: Record<string, string> = {};
    for (const field of spec.fields) {
      const v = values.get(field.key.toLowerCase());
      if (v === undefined) { if (field.required) errors.push(`${spec.label} has no "${field.key}:" line`); continue; }
      if (!field.name && v.length < (field.min ?? MIN)) errors.push(`${spec.label} "${field.key}" is too short to decide anything`);
      else if (v.length > MAX) errors.push(`${spec.label} "${field.key}" is longer than ${MAX} characters`);
      else obj[field.prop] = v;
    }
    out[spec.prop] = obj;
  }

  const listed = <T>(title: RegExp, label: string, parse: (l: string) => T | null, shape: string, limit: { min: number; max: number }): T[] => {
    const section = found.find(s => title.test(s.title));
    if (!section) { errors.push(`there is no "## ${label}" section`); return []; }
    const items: T[] = [];
    for (const line of bullets(section.lines)) {
      const item = parse(line);
      if (item) items.push(item); else errors.push(`${label}: "${line.slice(0, 60)}" does not read as ${shape}`);
    }
    if (items.length < limit.min || items.length > limit.max) errors.push(`${label} needs ${limit.min} to ${limit.max} lines, found ${items.length}`);
    return items;
  };
  const traits = listed(/^traits$/i, 'Traits', parseTrait, '"<trait>, not <its opposite>: <how it shows>"', TRAITS);
  const values = listed(/^values$/i, 'Values', parseValue, '"<this> over <that>: <what it means>"', VALUES);

  const archetype = out.archetype ?? {};
  const resolve = (label: string, raw: string | undefined): Archetype | 'custom' | null => {
    if (!raw) return null;
    const custom = /^custom\s*[:\-]\s*(.+)$/i.exec(raw);
    if (custom) { warnings.push(`${label} "${custom[1]}" is not in the catalogue: spell out how it acts and speaks so agents have something to follow`); return 'custom'; }
    const found = findArchetype(raw.replace(/\s*\(.*$/, ''));
    if (!found) errors.push(`${label} "${raw}" is not an archetype in the catalogue (npm run character -- catalogue); write "Custom: <name>" for one that is not`);
    return found ?? null;
  };
  const primary = resolve('Primary', archetype.primary);
  const secondary = resolve('Secondary', archetype.secondary);
  if (primary && secondary && primary !== 'custom' && secondary !== 'custom' && primary.name === secondary.name) errors.push('Secondary is the same archetype as Primary');

  if (archetype.why && mission) {
    const cited = [...archetype.why.matchAll(/\b(BC\d+|G\d+)\b/gi)].map(m => m[1].toUpperCase());
    const known = new Set([...mission.behaviourChanges.map(c => c.id), ...mission.goals.map(g => g.id)]);
    const unknown = cited.filter(id => !known.has(id));
    if (cited.length === 0) errors.push(`Archetype "Why" must tie the choice to the mission by citing a behaviour change or goal (${[...known].join(', ')})`);
    else if (unknown.length) errors.push(`Archetype "Why" cites ${[...new Set(unknown)].join(', ')}, which the mission does not have (${[...known].join(', ')})`);
  }

  const boundaries: Record<string, string> = out.boundaries ?? {};
  const humourNone = !!boundaries.humour && /^(none|no humou?r|never)\b/i.test(boundaries.humour);
  if (boundaries.never && boundaries.never.split(';').filter(x => x.trim().length > 2).length < 2) warnings.push('Boundaries "Never" lists fewer than two things: separate each with a semicolon, and name what this character would be tempted to do');
  if (primary && primary !== 'custom' && primary.name === 'Jester' && humourNone) warnings.push('Primary is Jester but Humour is none: pick another archetype or say where the humour belongs');
  if (boundaries.humour && !humourNone && out.moments?.ourFailure && /\b(joke|funny|humou?r|playful|witty)\b/i.test(out.moments.ourFailure)) warnings.push('Moments "Our failure" uses humour: people are rarely amused when the product has let them down');

  if (PLACEHOLDER.test(md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, ''))) errors.push('the file still contains template placeholders (<...>, TODO or TBD)');

  if (errors.length > 0) return { ok: false, errors, warnings };
  const character = { ...out, traits, values } as unknown as Character;
  if (!character.archetype.secondary) delete character.archetype.secondary;
  return { ok: true, character, warnings };
}

// ---- for agents ------------------------------------------------------------------------------------------------------

const note = (a: Archetype): Record<string, string> => ({ archetype: a.name, essence: a.essence, acts: a.acts, speaks: a.speaks, promise: a.promise, watch_for: a.care });

/** What the agents receive: the declared decisions, plus the catalogue's description of each chosen archetype. */
export function characterForAgents(c: Character): Record<string, unknown> {
  const notes = [c.archetype.primary, c.archetype.secondary].filter((x): x is string => !!x)
    .map(n => findArchetype(n.replace(/\s*\(.*$/, ''))).filter((x): x is Archetype => !!x);
  return {
    archetype: c.archetype,
    traits: c.traits,
    values: c.values,
    relationship: c.relationship,
    moments: c.moments,
    boundaries: c.boundaries,
    ...(notes.length ? { archetype_notes: notes.map(note) } : {})
  };
}

export function renderCharacterLine(c: Character): string {
  return `${c.archetype.primary}${c.archetype.secondary ? ` with ${c.archetype.secondary}` : ''}: ${c.traits.map(t => t.is).join(', ')}`;
}

// ---- loading ---------------------------------------------------------------------------------------------------------

export type CharacterLoad = { found: false } | { found: true; file: string; result: CharacterParse };

export function characterFile(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(cwd, env.FACTORY_CHARACTER_FILE || 'CHARACTER.md');
}

export function requireCharacter(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true)$/i.test(env.FACTORY_REQUIRE_CHARACTER ?? '');
}

export function loadCharacter(mission?: Mission, file: string = characterFile()): CharacterLoad {
  if (!fs.existsSync(file)) return { found: false };
  return { found: true, file, result: parseCharacter(fs.readFileSync(file, 'utf-8'), mission) };
}

// ---- what the frontend engineer must return --------------------------------------------------------------------------

/**
 * The frontend engineer must say how the interface's words and states follow the declared character, and list anything
 * it had to depart from. Returns problems in words the agent can act on when asked again.
 */
export function characterConformanceProblems(response: Record<string, unknown>): string[] {
  const r = response.character_fit;
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return ['character_fit is missing. The project has a declared character: return character_fit with traits and moments (how your work follows each) and deviations (a list, empty when none)'];
  }
  const o = r as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of ['traits', 'moments']) if (typeof o[k] !== 'string' || (o[k] as string).trim().length < MIN) problems.push(`character_fit.${k} must say how the work follows the declared ${k}`);
  if (!Array.isArray(o.deviations)) problems.push('character_fit.deviations must be a list (empty when the work departs from nothing)');
  return problems;
}
