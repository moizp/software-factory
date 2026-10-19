import * as fs from 'fs';
import * as path from 'path';
import { Style, findStyle } from './lookfeel-catalogue';
import type { Mission } from './mission';

/**
 * A project's look and feel, declared in LOOKFEEL.md: more than colours and type. It fixes the design language, what the
 * interface feels made of, how it moves, whether and how it sounds, how interaction feels, and how the product speaks,
 * all chosen against the project's mission and goals. Development follows it. Everything here is pure except `loadLookFeel`.
 *
 *   # Look and feel
 *   ## Direction            Primary, Secondary (optional), Why (cites BCn / Gn)
 *   ## Tone                 Voice, Say, Avoid
 *   ## Materials            Surfaces, Light and depth, Texture, Shape
 *   ## Colour and type      Palette (hex colours with a readable pair), Type
 *   ## Motion               Character, Timing, Never animate, Reduced motion
 *   ## Sound                Use, Character, Moments, Control
 *   ## Interaction feel     Rhythm, Feedback, Input
 */

export interface LookFeel {
  direction: { primary: string; secondary?: string; why: string };
  tone: { voice: string; say: string; avoid: string };
  materials: { surfaces: string; lightAndDepth: string; texture: string; shape: string };
  colourAndType: { palette: string; type: string };
  motion: { character: string; timing: string; neverAnimate: string; reducedMotion: string };
  sound: { use: string; character?: string; moments?: string; control: string };
  interaction: { rhythm: string; feedback: string; input: string };
}

export type LookFeelParse =
  | { ok: true; lookFeel: LookFeel; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const MIN = 8;
const MAX = 500;
const PLACEHOLDER = /<[^>\n]{1,100}>|\b(?:TODO|TBD|lorem ipsum)\b/i;
/** WCAG AA contrast for body text. */
export const MIN_CONTRAST = 4.5;
const LONG_ANIMATION_MS = 700;

interface Field {
  key: string;
  /** Property name on the section object. */
  prop: string;
  required: boolean;
  /** A style name, which is checked against the catalogue instead of for length ("Ma" is a whole answer). */
  name?: boolean;
}

interface SectionSpec {
  title: RegExp;
  label: string;
  prop: keyof LookFeel;
  fields: Field[];
}

const f = (key: string, prop: string, required = true, name = false): Field => ({ key, prop, required, ...(name ? { name } : {}) });

const SPEC: SectionSpec[] = [
  { title: /^direction$/i, label: 'Direction', prop: 'direction', fields: [f('Primary', 'primary', true, true), f('Secondary', 'secondary', false, true), f('Why', 'why')] },
  { title: /^tone$/i, label: 'Tone', prop: 'tone', fields: [f('Voice', 'voice'), f('Say', 'say'), f('Avoid', 'avoid')] },
  { title: /^materials$/i, label: 'Materials', prop: 'materials', fields: [f('Surfaces', 'surfaces'), f('Light and depth', 'lightAndDepth'), f('Texture', 'texture'), f('Shape', 'shape')] },
  { title: /^colou?r and type$/i, label: 'Colour and type', prop: 'colourAndType', fields: [f('Palette', 'palette'), f('Type', 'type')] },
  { title: /^motion$/i, label: 'Motion', prop: 'motion', fields: [f('Character', 'character'), f('Timing', 'timing'), f('Never animate', 'neverAnimate'), f('Reduced motion', 'reducedMotion')] },
  { title: /^sound$/i, label: 'Sound', prop: 'sound', fields: [f('Use', 'use'), f('Character', 'character', false), f('Moments', 'moments', false), f('Control', 'control')] },
  { title: /^interaction(?: feel)?$/i, label: 'Interaction feel', prop: 'interaction', fields: [f('Rhythm', 'rhythm'), f('Feedback', 'feedback'), f('Input', 'input')] }
];

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

// ---- colour ----------------------------------------------------------------------------------------------------------

export function hexColours(text: string): string[] {
  return [...text.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map(m => m[0].toLowerCase());
}

function luminance(hex: string): number {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The best contrast any two colours in the list reach: the question is whether text can be read at all. */
export function bestContrast(colours: string[]): number {
  let best = 1;
  for (let i = 0; i < colours.length; i++) for (let j = i + 1; j < colours.length; j++) best = Math.max(best, contrast(colours[i], colours[j]));
  return best;
}

// ---- parsing ---------------------------------------------------------------------------------------------------------

/**
 * Reads LOOKFEEL.md. Errors mean agents must not be given it; warnings are advice. Pass the project's mission and the
 * "Why" must cite at least one of its behaviour changes (or goals), and only ids it has.
 */
export function parseLookFeel(md: string, mission?: Mission): LookFeelParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const found = sectionsOf(md);
  const out: Record<string, Record<string, string>> = {};

  for (const spec of SPEC) {
    const section = found.find(s => spec.title.test(s.title));
    if (!section) { errors.push(`there is no "## ${spec.label}" section`); continue; }
    const values = keyed(section.lines);
    const obj: Record<string, string> = {};
    for (const field of spec.fields) {
      const v = values.get(field.key.toLowerCase());
      if (v === undefined) { if (field.required) errors.push(`${spec.label} has no "${field.key}:" line`); continue; }
      if (!field.name && v.length < MIN) errors.push(`${spec.label} "${field.key}" is too short to decide anything`);
      else if (v.length > MAX) errors.push(`${spec.label} "${field.key}" is longer than ${MAX} characters`);
      else obj[field.prop] = v;
    }
    out[spec.prop] = obj;
  }

  const direction = out.direction ?? {};
  const resolve = (label: string, raw: string | undefined): Style | 'custom' | null => {
    if (!raw) return null;
    const custom = /^custom\s*[:\-]\s*(.+)$/i.exec(raw);
    if (custom) { warnings.push(`${label} "${custom[1]}" is not in the catalogue: spell out its materials, motion, sound and interaction so agents have something to follow`); return 'custom'; }
    const style = findStyle(raw.replace(/\s*\(.*$/, ''));
    if (!style) errors.push(`${label} "${raw}" is not a style in the catalogue (npm run lookfeel -- catalogue); write "Custom: <name>" for one that is not`);
    return style ?? null;
  };
  const primary = resolve('Primary', direction.primary);
  const secondary = resolve('Secondary', direction.secondary);
  if (primary && secondary && primary !== 'custom' && secondary !== 'custom' && primary.name === secondary.name) errors.push('Secondary is the same style as Primary');

  if (direction.why && mission) {
    const cited = [...direction.why.matchAll(/\b(BC\d+|G\d+)\b/gi)].map(m => m[1].toUpperCase());
    const known = new Set([...mission.behaviourChanges.map(c => c.id), ...mission.goals.map(g => g.id)]);
    const unknown = cited.filter(id => !known.has(id));
    if (cited.length === 0) errors.push(`Direction "Why" must tie the choice to the mission by citing a behaviour change or goal (${[...known].join(', ')})`);
    else if (unknown.length) errors.push(`Direction "Why" cites ${[...new Set(unknown)].join(', ')}, which the mission does not have (${[...known].join(', ')})`);
  }

  const colour = out.colourAndType ?? {};
  if (colour.palette) {
    const colours = hexColours(colour.palette);
    if (colours.length < 3) errors.push('Colour and type "Palette" must name at least three colours as hex values (such as #1b1b1b)');
    else {
      if (colours.length > 8) warnings.push('Colour and type "Palette" has more than eight colours: a palette this wide is not a decision');
      if (bestContrast(colours) < MIN_CONTRAST) errors.push(`no two palette colours reach a ${MIN_CONTRAST}:1 contrast ratio, so text could not be read on any of them (WCAG AA)`);
    }
  }

  const motion = out.motion ?? {};
  if (motion.timing) {
    const longest = Math.max(0, ...[...motion.timing.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s)\b/gi)].map(m => parseFloat(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1)));
    if (longest > LONG_ANIMATION_MS) warnings.push(`Motion "Timing" allows ${longest} ms: anything over ${LONG_ANIMATION_MS} ms in an interaction feels like waiting unless it is a deliberate pause`);
  }

  const sound = out.sound ?? {};
  const silent = !!sound.use && /^(none|no sound|silent|silence)\b/i.test(sound.use);
  if (sound.use && !silent) {
    if (!sound.character) errors.push('Sound "Character:" is required when the product makes sounds');
    if (!sound.moments) errors.push('Sound "Moments:" is required when the product makes sounds: say exactly when');
    if (sound.control && !/\b(mute|muted|off|toggle|setting|switch|disable)/i.test(sound.control)) errors.push('Sound "Control" must say how a person turns sound off (mute, off by default, a setting)');
  }

  if (PLACEHOLDER.test(md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, ''))) errors.push('the file still contains template placeholders (<...>, TODO or TBD)');

  if (errors.length > 0) return { ok: false, errors, warnings };
  const lookFeel = out as unknown as LookFeel;
  if (!lookFeel.direction.secondary) delete lookFeel.direction.secondary;
  if (silent) { delete lookFeel.sound.character; delete lookFeel.sound.moments; }
  return { ok: true, lookFeel, warnings };
}

// ---- for agents ------------------------------------------------------------------------------------------------------

const note = (st: Style): Record<string, string> => ({
  style: st.name, essence: st.essence, materials: st.materials, form: st.form, motion: st.motion, sound: st.sound, interaction: st.interaction, watch_for: st.care
});

/** What the agents receive: the declared decisions, plus the catalogue's description of each chosen style. */
export function lookFeelForAgents(lf: LookFeel): Record<string, unknown> {
  const styles = [lf.direction.primary, lf.direction.secondary].filter((x): x is string => !!x)
    .map(n => findStyle(n.replace(/\s*\(.*$/, ''))).filter((x): x is Style => !!x);
  return {
    direction: lf.direction,
    tone: lf.tone,
    materials: lf.materials,
    colour_and_type: lf.colourAndType,
    motion: lf.motion,
    sound: lf.sound,
    interaction: lf.interaction,
    ...(styles.length ? { style_notes: styles.map(note) } : {})
  };
}

export function renderLookFeelLine(lf: LookFeel): string {
  return `${lf.direction.primary}${lf.direction.secondary ? ` with ${lf.direction.secondary}` : ''}`;
}

// ---- loading ---------------------------------------------------------------------------------------------------------

export type LookFeelLoad = { found: false } | { found: true; file: string; result: LookFeelParse };

export function lookFeelFile(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(cwd, env.FACTORY_LOOKFEEL_FILE || 'LOOKFEEL.md');
}

export function requireLookFeel(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true)$/i.test(env.FACTORY_REQUIRE_LOOKFEEL ?? '');
}

export function loadLookFeel(mission?: Mission, file: string = lookFeelFile()): LookFeelLoad {
  if (!fs.existsSync(file)) return { found: false };
  return { found: true, file, result: parseLookFeel(fs.readFileSync(file, 'utf-8'), mission) };
}

// ---- what the frontend engineer must return --------------------------------------------------------------------------

const APPLIED = ['style', 'materials', 'motion', 'sound', 'interaction'] as const;

/**
 * The frontend engineer must say how its work follows the declared look and feel, in each of the five areas, and list
 * anything it had to depart from. Returns problems in words the agent can act on when asked again.
 */
export function conformanceProblems(response: Record<string, unknown>): string[] {
  const r = response.look_and_feel;
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    return [`look_and_feel is missing. The project has a declared look and feel: return look_and_feel with ${APPLIED.join(', ')} (how your work follows each) and deviations (a list, empty when none)`];
  }
  const o = r as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of APPLIED) if (typeof o[k] !== 'string' || (o[k] as string).trim().length < MIN) problems.push(`look_and_feel.${k} must say how the work follows the ${k}`);
  if (!Array.isArray(o.deviations)) problems.push('look_and_feel.deviations must be a list (empty when the work departs from nothing)');
  return problems;
}
