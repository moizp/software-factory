import * as fs from 'fs';
import * as path from 'path';

/**
 * A project's mission: what we are trying to achieve together with our users, and the behaviour changes we expect in
 * them. It lives in the project, in MISSION.md, and planning agents are held to it. Everything here is pure except
 * `loadMission`.
 *
 *   # Mission
 *   One or two sentences.
 *
 *   ## Users
 *   - Who they are: their situation today
 *
 *   ## Behaviour changes
 *   ### BC1: Short name
 *   - Who: ...        - From: what they do today      - To: what we want them to do      - Signal: how we would see it
 *
 *   ## Goals            (optional)
 *   - Secondary aims that are not behaviour changes: nice to advance, never required
 *
 *   ## Not our mission
 *   - Things we will not do, even when asked
 */

export interface BehaviourChange {
  id: string;
  name: string;
  who: string;
  from: string;
  to: string;
  signal: string;
}

/** An optional aim next to the behaviour changes: something worth advancing, never a reason to say yes or no on its own. */
export interface Goal {
  id: string;
  text: string;
}

export interface Mission {
  mission: string;
  users: string[];
  behaviourChanges: BehaviourChange[];
  /** Optional. Empty when the file declares none. */
  goals: Goal[];
  notOurMission: string[];
}

export type MissionParse =
  | { ok: true; mission: Mission; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const MAX_CHANGES = 8;
const MAX_GOALS = 6;
const MAX_GOAL_CHARS = 300;
const MIN_FIELD = 8;
const MAX_FIELD = 400;
const FIELDS = ['who', 'from', 'to', 'signal'] as const;
const PLACEHOLDER = /<[^>\n]{1,80}>|\b(?:TODO|TBD|lorem ipsum)\b/i;
/** Verbs that name work to do, not something a user does. */
const WORK_VERB = /^(?:add|build|create|implement|ship|launch|release|develop|support|provide|offer|deliver|introduce)\b/i;
/** Measures of our own output. They say how much we made, not whether any user changed what they do. */
const VANITY = /\b(?:lines? of code|loc|commits?|pull requests?|prs|tokens?|story points?|velocity|throughput|features? shipped|releases? (?:made|shipped)|tickets? closed|issues? closed)\b/i;
const MEASURABLE = /\d|\b(?:rate|share|count|number|percent|per|times?|weekly|daily|monthly|within|fewer|more|less|ratio)\b/i;

interface Section {
  title: string;
  level: number;
  lines: string[];
}

function sections(md: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  let fenced = false;
  for (const line of md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    const m = !fenced && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      current = { title: m[2], level: m[1].length, lines: [] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out;
}

const bullets = (lines: string[]): string[] =>
  lines.map(l => /^\s*[-*]\s+(.*\S)\s*$/.exec(l)?.[1]).filter((x): x is string => !!x);

const paragraph = (lines: string[]): string => lines.map(l => l.trim()).filter(Boolean).join(' ');

/** Reads MISSION.md. Errors mean the agents must not be given it; warnings are advice. */
export function parseMission(md: string): MissionParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = sections(md);
  const find = (re: RegExp, level?: number): Section | undefined => all.find(s => re.test(s.title) && (level === undefined || s.level === level));

  const missionSection = find(/^mission$/i);
  const statement = missionSection ? paragraph(missionSection.lines) : '';
  if (!missionSection) errors.push('there is no "# Mission" section');
  else if (statement.length < 20) errors.push('the mission statement is too short to say anything (at least 20 characters)');
  else if (statement.length > 600) errors.push('the mission statement is longer than 600 characters; say it in a sentence or two');

  const usersSection = find(/^users$/i);
  const users = usersSection ? bullets(usersSection.lines) : [];
  if (!usersSection || users.length === 0) errors.push('"## Users" must list at least one group of users as a bullet');

  const changesIndex = all.findIndex(s => /^behaviou?r changes$/i.test(s.title));
  const changes: BehaviourChange[] = [];
  if (changesIndex < 0) {
    errors.push('there is no "## Behaviour changes" section');
  } else {
    const ids = new Set<string>();
    for (const s of all.slice(changesIndex + 1)) {
      if (s.level <= all[changesIndex].level) break;
      if (s.level !== all[changesIndex].level + 1) continue;
      const head = /^(BC\d+)\s*[:.\-]\s*(.+)$/i.exec(s.title);
      if (!head) {
        errors.push(`"### ${s.title}" must look like "### BC1: Short name"`);
        continue;
      }
      const id = head[1].toUpperCase();
      if (ids.has(id)) errors.push(`${id} appears twice`);
      ids.add(id);
      const fields: Record<string, string> = {};
      for (const b of bullets(s.lines)) {
        const f = /^(who|from|to|signal)\s*:\s*(.+)$/i.exec(b);
        if (f) fields[f[1].toLowerCase()] = f[2].trim();
      }
      const change: Partial<BehaviourChange> = { id, name: head[2].trim() };
      for (const key of FIELDS) {
        const v = fields[key];
        if (!v) errors.push(`${id} has no "${key[0].toUpperCase()}${key.slice(1)}:" line`);
        else if (v.length < MIN_FIELD) errors.push(`${id} "${key}" is too short to mean anything`);
        else if (v.length > MAX_FIELD) errors.push(`${id} "${key}" is longer than ${MAX_FIELD} characters`);
        else change[key] = v;
      }
      if (FIELDS.every(k => change[k])) {
        if (change.from!.toLowerCase() === change.to!.toLowerCase()) errors.push(`${id} "from" and "to" are the same: that is not a change`);
        if (WORK_VERB.test(change.to!)) warnings.push(`${id} "to" starts with a verb for work ("${change.to!.split(/\s+/)[0]}"): say what users will do, not what we will build`);
        if (VANITY.test(change.signal!)) warnings.push(`${id} "signal" measures our output (${VANITY.exec(change.signal!)![0]}), not what users do: a signal is something a user does or feels that we can notice`);
        if (!MEASURABLE.test(change.signal!)) warnings.push(`${id} "signal" names nothing countable: how would we notice this change happening?`);
        changes.push(change as BehaviourChange);
      }
    }
    if (ids.size === 0) errors.push('"## Behaviour changes" must contain at least one "### BC1: ..." block');
    if (ids.size > MAX_CHANGES) errors.push(`more than ${MAX_CHANGES} behaviour changes: a mission this wide cannot steer anything`);
  }

  const goalsSection = find(/^goals$|^optional goals$/i);
  const goals: Goal[] = [];
  if (goalsSection) {
    const items = bullets(goalsSection.lines);
    if (items.length > MAX_GOALS) errors.push(`more than ${MAX_GOALS} goals: optional goals are a short list, or they steer nothing`);
    items.forEach((raw, i) => {
      const text = raw.replace(/^G\d+\s*[:.\-]\s*/i, '').trim();
      if (text.length < MIN_FIELD) errors.push(`goal ${i + 1} is too short to mean anything`);
      else if (text.length > MAX_GOAL_CHARS) errors.push(`goal ${i + 1} is longer than ${MAX_GOAL_CHARS} characters`);
      else goals.push({ id: `G${i + 1}`, text });
    });
  }

  const nots = find(/^not our mission$|^non-goals$/i);
  const notOur = nots ? bullets(nots.lines) : [];
  if (!nots || notOur.length === 0) warnings.push('"## Not our mission" is empty: without a line drawn, nothing is ever out of mission');

  if (PLACEHOLDER.test(md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, ''))) errors.push('the file still contains template placeholders (<...>, TODO or TBD)');

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, mission: { mission: statement, users, behaviourChanges: changes, goals, notOurMission: notOur }, warnings };
}

/** The mission as the agents receive it: short keys, nothing they do not need. */
export function missionForAgents(m: Mission): Record<string, unknown> {
  return {
    mission: m.mission,
    users: m.users,
    behaviour_changes: m.behaviourChanges.map(c => ({ id: c.id, name: c.name, who: c.who, from: c.from, to: c.to, signal: c.signal })),
    ...(m.goals.length ? { goals: m.goals } : {}),
    not_our_mission: m.notOurMission
  };
}

export const missionIds = (m: Mission): string[] => m.behaviourChanges.map(c => c.id);

export type MissionLoad =
  | { found: false }
  | { found: true; file: string; result: MissionParse };

export function missionFile(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(cwd, env.FACTORY_MISSION_FILE || 'MISSION.md');
}

export function requireMission(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true)$/i.test(env.FACTORY_REQUIRE_MISSION ?? '');
}

export function loadMission(file: string = missionFile()): MissionLoad {
  if (!fs.existsSync(file)) return { found: false };
  return { found: true, file, result: parseMission(fs.readFileSync(file, 'utf-8')) };
}

// ---- what an issue declares ----------------------------------------------------------------------------------------

export interface Declaration {
  /** Behaviour change ids named on `Serves:` lines, upper case, no repeats. */
  serves: string[];
  /** The reason on a `Mission exception:` line, when there is one. */
  exception?: string;
  /** Things on those lines that cannot be used. */
  problems: string[];
}

const MIN_EXCEPTION = 10;

/**
 * What an issue (or any brief) says about the mission, from lines that start with `Serves:` (ids such as BC1, BC3) or
 * `Mission exception:` (a reason). Quoted lines and code blocks are ignored, so an example in a comment does not count.
 */
export function parseDeclaration(text: string): Declaration {
  const serves: string[] = [];
  const problems: string[] = [];
  let exception: string | undefined;
  let fenced = false;
  for (const raw of text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { fenced = !fenced; continue; }
    if (fenced || /^\s*>/.test(raw)) continue;
    const line = raw.replace(/^\s*(?:[-*]\s+)?/, '').replace(/\*\*/g, '');
    const s = /^serves\s*:\s*(.*)$/i.exec(line);
    if (s) {
      const tokens = s[1].split(/[\s,;]+|\band\b/i).map(t => t.trim()).filter(Boolean);
      if (tokens.length === 0) problems.push('"Serves:" names no behaviour change');
      for (const t of tokens) {
        if (/^BC\d+$/i.test(t)) { if (!serves.includes(t.toUpperCase())) serves.push(t.toUpperCase()); }
        else problems.push(`"${t}" is not a behaviour change id (they look like BC1)`);
      }
      continue;
    }
    const e = /^mission\s+exception\s*:\s*(.*)$/i.exec(line);
    if (e) {
      const reason = e[1].trim();
      if (reason.length < MIN_EXCEPTION) problems.push(`"Mission exception:" needs a reason of at least ${MIN_EXCEPTION} characters`);
      else exception = reason;
    }
  }
  return { serves, ...(exception ? { exception } : {}), problems };
}

export type MissionGate =
  | { state: 'none'; required: boolean }
  | { state: 'unusable'; errors: string[] }
  | { state: 'ok'; behaviourChanges: Array<{ id: string; name: string }> };

export type GateResult = { ok: true; note?: string } | { ok: false; reasons: string[] };

/**
 * The router's question before any tokens are spent: does this issue say which behaviour change it serves (or why it is
 * an exception)? It checks that the issue says so, not whether it is true: the product manager checks the substance.
 */
export function checkDeclaration(gate: MissionGate, decl: Declaration): GateResult {
  if (gate.state === 'none') {
    return gate.required
      ? { ok: false, reasons: ['The project has no MISSION.md and FACTORY_REQUIRE_MISSION is on. Declare the mission (.claude/skills/mission.md), then re-apply the label.'] }
      : { ok: true };
  }
  if (gate.state === 'unusable') {
    return { ok: false, reasons: [`MISSION.md cannot be used, so no work can be checked against it: ${gate.errors.join('; ')}`] };
  }

  const list = gate.behaviourChanges.map(c => `${c.id} ${c.name}`).join('; ');
  const known = new Set(gate.behaviourChanges.map(c => c.id));
  const unknown = decl.serves.filter(id => !known.has(id));
  const how = 'Add a line "Serves: BC1" (or several, such as "Serves: BC1, BC3") to the issue, or, if the work moves none of them and should still be done, a line "Mission exception: <why>". Then remove and re-apply the label.';

  if (decl.problems.length > 0) return { ok: false, reasons: [...decl.problems, `Behaviour changes in MISSION.md: ${list}.`, how] };
  if (unknown.length > 0) return { ok: false, reasons: [`The issue says it serves ${unknown.join(', ')}, which MISSION.md does not have. It has: ${list}.`, how] };
  if (decl.serves.length > 0) return { ok: true, note: `mission: serves ${decl.serves.join(', ')}` };
  if (decl.exception) return { ok: true, note: `mission: exception declared (${decl.exception.slice(0, 120)})` };
  return { ok: false, reasons: [`This issue does not say which behaviour change it serves. The project's mission has: ${list}.`, how] };
}

// ---- what the planning agents must return ----------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the product manager's answer against the mission: every feature says which behaviour changes it serves, or is
 * listed as out of mission with a reason, and a must-have feature cannot be out of mission (that is a question for a person).
 * Returns the problems in words the agent can act on when it is asked again.
 */
export function alignmentProblems(
  mission: Mission,
  response: Record<string, unknown>,
  /** What the brief declared: ids it says it serves, and whether a person declared a one-off exception. */
  declared: { serves?: string[]; exception?: boolean } = {}
): string[] {
  const ids = new Set(missionIds(mission));
  const problems: string[] = [];
  const align = response.mission_alignment;
  if (!isRecord(align)) {
    return [`mission_alignment is missing. The project has a mission (behaviour changes ${[...ids].join(', ')}): return mission_alignment with behaviour_changes_covered, behaviour_changes_not_covered and out_of_mission`];
  }
  const list = (key: string): string[] | null => (Array.isArray(align[key]) && (align[key] as unknown[]).every(x => typeof x === 'string') ? (align[key] as string[]) : null);
  for (const key of ['behaviour_changes_covered', 'behaviour_changes_not_covered']) {
    const l = list(key);
    if (!l) problems.push(`mission_alignment.${key} must be a list of behaviour change ids`);
    else for (const id of l) if (!ids.has(id)) problems.push(`mission_alignment.${key} names ${id}, which is not in the mission (${[...ids].join(', ')})`);
  }
  const outOf = Array.isArray(align.out_of_mission) ? align.out_of_mission : null;
  if (!outOf) problems.push('mission_alignment.out_of_mission must be a list (empty when every feature is in mission)');
  const outNames = new Set<string>();
  for (const o of outOf ?? []) {
    if (!isRecord(o) || typeof o.feature !== 'string' || typeof o.reason !== 'string' || !o.reason.trim()) {
      problems.push('each out_of_mission entry needs "feature" and "reason"');
    } else outNames.add(o.feature);
  }

  const features = isRecord(response.features) ? response.features : {};
  for (const tier of ['must_have', 'nice_to_have']) {
    const items = Array.isArray(features[tier]) ? (features[tier] as unknown[]) : [];
    for (const f of items) {
      if (!isRecord(f) || typeof f.name !== 'string') continue;
      const serves = Array.isArray(f.serves) ? (f.serves as unknown[]) : null;
      if (outNames.has(f.name)) {
        if (tier === 'must_have' && !declared.exception) problems.push(`must-have feature "${f.name}" is listed as out of mission: a must-have has to serve a behaviour change; tie it to one, or leave it out and ask a person with needs_human`);
        continue;
      }
      if (!serves || serves.length === 0) problems.push(`feature "${f.name}" has no "serves": list the behaviour change ids it serves (${[...ids].join(', ')}), or put it under out_of_mission with a reason`);
      else for (const id of serves) if (typeof id !== 'string' || !ids.has(id)) problems.push(`feature "${f.name}" serves ${JSON.stringify(id)}, which is not in the mission (${[...ids].join(', ')})`);
    }
  }
  // The brief names the behaviour changes it serves: the plan has to deliver on them
  const served = new Set<string>();
  for (const tier of ['must_have', 'nice_to_have']) {
    for (const f of Array.isArray(features[tier]) ? (features[tier] as unknown[]) : []) {
      if (isRecord(f) && Array.isArray(f.serves)) for (const id of f.serves) if (typeof id === 'string') served.add(id);
    }
  }
  for (const id of declared.serves ?? []) {
    if (!ids.has(id)) continue;
    if (!served.has(id)) problems.push(`the brief says it serves ${id}, but no feature serves ${id}: tie a feature to ${id}, or ask a person with needs_human if the brief and the mission disagree`);
  }
  return problems;
}

/** Behaviour change ids a plan's phases refer to that the mission does not have. */
export function unknownServes(mission: Mission, serves: string[]): string[] {
  const ids = new Set(missionIds(mission));
  return serves.filter(id => !ids.has(id));
}

export function renderMissionLine(m: Mission): string {
  return `${m.mission} (${m.behaviourChanges.map(c => c.id).join(', ')})`;
}
