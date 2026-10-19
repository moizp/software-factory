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

export interface Mission {
  mission: string;
  users: string[];
  behaviourChanges: BehaviourChange[];
  notOurMission: string[];
}

export type MissionParse =
  | { ok: true; mission: Mission; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const MAX_CHANGES = 8;
const MIN_FIELD = 8;
const MAX_FIELD = 400;
const FIELDS = ['who', 'from', 'to', 'signal'] as const;
const PLACEHOLDER = /<[^>\n]{1,80}>|\b(?:TODO|TBD|lorem ipsum)\b/i;
/** Verbs that name work to do, not something a user does. */
const WORK_VERB = /^(?:add|build|create|implement|ship|launch|release|develop|support|provide|offer|deliver|introduce)\b/i;
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
        if (!MEASURABLE.test(change.signal!)) warnings.push(`${id} "signal" names nothing countable: how would we notice this change happening?`);
        changes.push(change as BehaviourChange);
      }
    }
    if (ids.size === 0) errors.push('"## Behaviour changes" must contain at least one "### BC1: ..." block');
    if (ids.size > MAX_CHANGES) errors.push(`more than ${MAX_CHANGES} behaviour changes: a mission this wide cannot steer anything`);
  }

  const nots = find(/^not our mission$|^non-goals$/i);
  const notOur = nots ? bullets(nots.lines) : [];
  if (!nots || notOur.length === 0) warnings.push('"## Not our mission" is empty: without a line drawn, nothing is ever out of mission');

  if (PLACEHOLDER.test(md.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, ''))) errors.push('the file still contains template placeholders (<...>, TODO or TBD)');

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, mission: { mission: statement, users, behaviourChanges: changes, notOurMission: notOur }, warnings };
}

/** The mission as the agents receive it: short keys, nothing they do not need. */
export function missionForAgents(m: Mission): Record<string, unknown> {
  return {
    mission: m.mission,
    users: m.users,
    behaviour_changes: m.behaviourChanges.map(c => ({ id: c.id, name: c.name, who: c.who, from: c.from, to: c.to, signal: c.signal })),
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

// ---- what the planning agents must return ----------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Checks the product manager's answer against the mission: every feature says which behaviour changes it serves, or is
 * listed as out of mission with a reason, and a must-have feature cannot be out of mission (that is a question for a person).
 * Returns the problems in words the agent can act on when it is asked again.
 */
export function alignmentProblems(mission: Mission, response: Record<string, unknown>): string[] {
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
        if (tier === 'must_have') problems.push(`must-have feature "${f.name}" is listed as out of mission: a must-have has to serve a behaviour change; tie it to one, or leave it out and ask a person with needs_human`);
        continue;
      }
      if (!serves || serves.length === 0) problems.push(`feature "${f.name}" has no "serves": list the behaviour change ids it serves (${[...ids].join(', ')}), or put it under out_of_mission with a reason`);
      else for (const id of serves) if (typeof id !== 'string' || !ids.has(id)) problems.push(`feature "${f.name}" serves ${JSON.stringify(id)}, which is not in the mission (${[...ids].join(', ')})`);
    }
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
