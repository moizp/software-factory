import type { Mission } from './mission';
import { missionIds } from './mission';
import { VisualCheck, parseVisualChecks } from './evidence/checks';

/**
 * The architect's implementation plan: ordered phases, each with the files it touches and the checks that show it is
 * done, split into automated (commands) and manual (things a person looks at). A person reviews this plan before
 * anything is built, and after the build the files that were produced are compared with it.
 * Everything here is pure: checking the shape, summarising for a person, and comparing with what was built.
 */

export interface PlanPhase {
  name: string;
  goal?: string;
  /** Behaviour change ids from the project's mission that this phase serves. May be empty for groundwork. */
  serves: string[];
  files: string[];
  automated_checks: string[];
  manual_checks: string[];
  /** Screens a change to the interface is photographed on, before and after. Absent when the phase touches no interface. */
  visual_checks?: VisualCheck[];
}

/** A deep module: a small, stable interface in front of a complicated inside, with tests at the boundary. */
export interface PlanModule {
  name: string;
  purpose: string;
  /** The public surface: functions, endpoints, events. Few and stable. */
  interface: string[];
  /** What is hidden behind the interface and free to change. */
  hides: string;
  /** Tests that exercise the module through its interface only. */
  boundary_tests: string[];
}

/** A change to people, roles, workflows, skills or protocols that the plan assumes will happen alongside the code. */
export interface AssumedChange {
  change: string;
  affects: string;
}

/** Refactoring, simplification or removal of duplication that would keep the system healthy. */
export interface Future {
  what: string;
  why: string;
}

export interface ImplementationPlan {
  phases: PlanPhase[];
  modules: PlanModule[];
  /** Empty means the plan assumes no change to how people work; the key itself must be present. */
  assumed_changes: AssumedChange[];
  /** Empty means no health work was seen; the key itself must be present. */
  futures: Future[];
}

const MAX_PHASES = 12;
const MAX_FILES_PER_PHASE = 15;
const MAX_MODULES = 12;
const MAX_INTERFACE = 7;
const MIN_TEXT = 10;
const MAX_CHECKS_PER_LIST = 20;
const MAX_TEXT = 300;

type Parsed = { ok: true; plan: ImplementationPlan } | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === 'string';
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `./src//a.ts` becomes `src/a.ts`. Returns null for absolute paths or paths that climb out of the project. */
export function normalizePath(p: string): string | null {
  const t = p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');
  if (!t || t.startsWith('/') || /^[A-Za-z]:/.test(t) || t.split('/').includes('..')) return null;
  return t;
}

function fileList(raw: unknown, where: string): { ok: true; files: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: `${where}.files must list at least one file` };
  if (raw.length > MAX_FILES_PER_PHASE) return { ok: false, error: `${where}.files has more than ${MAX_FILES_PER_PHASE} entries; split the phase` };
  const files: string[] = [];
  for (const entry of raw) {
    const path = isString(entry) ? entry : isRecord(entry) && isString(entry.path) ? entry.path : null;
    const clean = path === null ? null : normalizePath(path);
    if (clean === null) return { ok: false, error: `${where}.files entries must be relative paths inside the project (a string or {"path": ...}); got ${JSON.stringify(entry).slice(0, 80)}` };
    files.push(clean);
  }
  return { ok: true, files: [...new Set(files)] };
}

function checkList(raw: unknown, where: string): { ok: true; checks: string[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, checks: [] };
  if (!Array.isArray(raw) || raw.length > MAX_CHECKS_PER_LIST) return { ok: false, error: `${where} must be a list of at most ${MAX_CHECKS_PER_LIST} entries` };
  const checks: string[] = [];
  for (const entry of raw) {
    const text = isString(entry) ? entry : isRecord(entry) && isString(entry.command) ? entry.command : isRecord(entry) && isString(entry.description) ? entry.description : null;
    if (text === null || !text.trim() || text.length > MAX_TEXT) return { ok: false, error: `${where} entries must be non-empty strings of at most ${MAX_TEXT} characters` };
    checks.push(text.trim());
  }
  return { ok: true, checks };
}

/** Checks what the architect sent. A bad plan is described precisely so the agent can fix it when asked again. */
export function parsePlan(raw: unknown, opts: { mission?: Mission } = {}): Parsed {
  if (!isRecord(raw)) return { ok: false, error: 'implementation_plan must be an object with a "phases" list' };
  const phases = raw.phases;
  if (!Array.isArray(phases) || phases.length === 0) return { ok: false, error: 'implementation_plan.phases must list at least one phase' };
  if (phases.length > MAX_PHASES) return { ok: false, error: `implementation_plan.phases has more than ${MAX_PHASES} phases; a person must be able to read it` };

  const out: PlanPhase[] = [];
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const where = `implementation_plan.phases[${i}]`;
    if (!isRecord(p)) return { ok: false, error: `${where} must be an object` };
    if (!isString(p.name) || !p.name.trim() || p.name.length > MAX_TEXT) return { ok: false, error: `${where}.name must be a short non-empty string` };
    if (p.goal !== undefined && (!isString(p.goal) || p.goal.length > 1000)) return { ok: false, error: `${where}.goal must be a string of at most 1000 characters` };

    const files = fileList(p.files, where);
    if (!files.ok) return files;
    let serves: string[] = [];
    if (p.serves !== undefined) {
      if (!Array.isArray(p.serves) || !p.serves.every(isString)) return { ok: false, error: `${where}.serves must be a list of behaviour change ids from the mission` };
      serves = [...new Set((p.serves as string[]).map(s => s.trim()))];
      if (opts.mission) {
        const known = new Set(missionIds(opts.mission));
        const unknown = serves.filter(id => !known.has(id));
        if (unknown.length) return { ok: false, error: `${where}.serves names ${unknown.join(', ')}, which ${unknown.length === 1 ? 'is' : 'are'} not in the mission (${[...known].join(', ')})` };
      }
    }

    const automated = checkList(p.automated_checks, `${where}.automated_checks`);
    if (!automated.ok) return automated;
    const manual = checkList(p.manual_checks, `${where}.manual_checks`);
    if (!manual.ok) return manual;
    if (automated.checks.length === 0) {
      return { ok: false, error: `${where} needs at least one command in automated_checks: a step small enough to test is a step with a test, and a manual check alone cannot show it is done` };
    }
    const visual = parseVisualChecks(p.visual_checks, `${where}.visual_checks`);
    if (!visual.ok) return { ok: false, error: visual.error };
    out.push({
      name: p.name.trim(),
      ...(isString(p.goal) && p.goal.trim() ? { goal: p.goal.trim() } : {}),
      serves,
      files: files.files,
      automated_checks: automated.checks,
      manual_checks: manual.checks,
      ...(visual.value.length ? { visual_checks: visual.value } : {})
    });
  }
  const modules = parseModules(raw.modules);
  if (!modules.ok) return modules;
  const changes = parseAssumedChanges(raw.assumed_changes);
  if (!changes.ok) return changes;
  const futures = parseFutures(raw.futures);
  if (!futures.ok) return futures;
  return { ok: true, plan: { phases: out, modules: modules.modules, assumed_changes: changes.changes, futures: futures.futures } };
}

type Result<K extends string, T> = ({ ok: true } & Record<K, T>) | { ok: false; error: string };

const text = (v: unknown, min = 1): v is string => isString(v) && v.trim().length >= min && v.length <= MAX_TEXT;

function parseModules(raw: unknown): Result<'modules', PlanModule[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'implementation_plan.modules must list the modules the work is split into, each with a purpose, a small interface, what it hides and tests at its boundary' };
  }
  if (raw.length > MAX_MODULES) return { ok: false, error: `implementation_plan.modules has more than ${MAX_MODULES} modules; group them so a person can hold the design in their head` };
  const modules: PlanModule[] = [];
  const names = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    const where = `implementation_plan.modules[${i}]`;
    if (!isRecord(m)) return { ok: false, error: `${where} must be an object` };
    if (!text(m.name)) return { ok: false, error: `${where}.name must be a short non-empty string` };
    if (names.has(m.name.trim().toLowerCase())) return { ok: false, error: `${where}.name "${m.name}" is used twice` };
    names.add(m.name.trim().toLowerCase());
    if (!text(m.purpose, MIN_TEXT)) return { ok: false, error: `${where}.purpose must say in a sentence what the module is for` };
    const api = Array.isArray(m.interface) ? m.interface : null;
    if (!api || api.length === 0 || !api.every(x => text(x))) return { ok: false, error: `${where}.interface must list the module's public surface as short strings` };
    if (api.length > MAX_INTERFACE) return { ok: false, error: `${where}.interface has ${api.length} entries; a deep module has at most ${MAX_INTERFACE}: narrow it or split the module` };
    if (!text(m.hides, MIN_TEXT)) return { ok: false, error: `${where}.hides must say what is kept inside the module, or it is a shallow wrapper` };
    const tests = Array.isArray(m.boundary_tests) ? m.boundary_tests : null;
    if (!tests || tests.length === 0 || !tests.every(x => text(x))) return { ok: false, error: `${where}.boundary_tests must list at least one test that exercises the module through its interface only` };
    modules.push({
      name: m.name.trim(), purpose: m.purpose.trim(), interface: (api as string[]).map(x => x.trim()),
      hides: m.hides.trim(), boundary_tests: (tests as string[]).map(x => x.trim())
    });
  }
  return { ok: true, modules };
}

function parseAssumedChanges(raw: unknown): Result<'changes', AssumedChange[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'implementation_plan.assumed_changes must be a list of changes to people, roles, workflows, skills or protocols that this plan assumes (an empty list says it assumes none)' };
  const changes: AssumedChange[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!isRecord(c) || !text(c.change, MIN_TEXT) || !text(c.affects)) return { ok: false, error: `implementation_plan.assumed_changes[${i}] must be {"change": what has to change, "affects": who or what it affects}` };
    changes.push({ change: c.change.trim(), affects: c.affects.trim() });
  }
  return { ok: true, changes };
}

function parseFutures(raw: unknown): Result<'futures', Future[]> {
  if (!Array.isArray(raw)) return { ok: false, error: 'implementation_plan.futures must be a list of refactoring, simplification or de-duplication work that would keep the system healthy (an empty list says none was seen)' };
  const futures: Future[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    if (!isRecord(f) || !text(f.what, MIN_TEXT) || !text(f.why, MIN_TEXT)) return { ok: false, error: `implementation_plan.futures[${i}] must be {"what": the work, "why": what it keeps open}` };
    futures.push({ what: f.what.trim(), why: f.why.trim() });
  }
  return { ok: true, futures };
}

const TEST_FILE = /(?:\.|_)(?:test|spec)\.[a-z]+$|(?:^|\/)(?:__tests__|tests?|spec)\//i;

/** Whether a phase's files include a test, so the plan can say which steps have no test file planned. */
export function hasTestFile(files: string[]): boolean {
  return files.some(f => TEST_FILE.test(f));
}

/** The plan as a person reads it: phases, files and checks. Cut at `maxChars` with a note, never mid-line. */
export function renderPlanSummary(plan: ImplementationPlan, maxChars = 6000, mission?: Mission): string {
  const lines: string[] = [];
  plan.phases.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.name}**${p.goal ? `: ${p.goal}` : ''}`);
    if (mission) lines.push(`   - Serves: ${p.serves.length ? p.serves.join(', ') : 'no behaviour change directly (groundwork)'}`);
    lines.push(`   - Files (${p.files.length}): ${p.files.slice(0, 8).join(', ')}${p.files.length > 8 ? `, and ${p.files.length - 8} more` : ''}`);
    p.automated_checks.forEach(c => lines.push(`   - Automated: \`${c}\``));
    p.manual_checks.forEach(c => lines.push(`   - Manual: ${c}`));
    (p.visual_checks ?? []).forEach(v => lines.push(`   - Picture: ${v.path} at ${v.widths.join(', ')} px${v.state ? ` (${v.state})` : ''}, before and after`));
    if (!hasTestFile(p.files)) lines.push('   - No test file is planned in this step');
  });
  lines.push(`Modules (${plan.modules.length}): ${plan.modules.map(m => `${m.name} [${m.interface.join(', ')}]`).join('; ')}`);
  lines.push(plan.assumed_changes.length
    ? `Assumed changes to how people work: ${plan.assumed_changes.map(c => `${c.change} (affects ${c.affects})`).join('; ')}`
    : 'Assumed changes to how people work: none');
  lines.push(plan.futures.length ? `Futures proposed: ${plan.futures.map(f => `${f.what} (${f.why})`).join('; ')}` : 'Futures proposed: none');
  if (mission) {
    const served = new Set(plan.phases.flatMap(ph => ph.serves));
    const left = missionIds(mission).filter(id => !served.has(id));
    lines.push(left.length ? `Mission: not served by this plan: ${left.join(', ')}` : 'Mission: every behaviour change is served by some phase');
  }
  const notice = '\n(The rest of the plan is in the workflow state.)';
  let text = '';
  for (const line of lines) {
    if (text.length + line.length + 1 > maxChars - notice.length) return text + notice;
    text += (text ? '\n' : '') + line;
  }
  return text;
}

const APPROVALS = ['approve', 'approved', 'yes', 'y', 'ok', 'okay', 'lgtm', 'looks good', 'go', 'go ahead'];

/** True when the answer to a plan question is a plain approval. Anything else is taken as a request for changes. */
export function isApproval(answer: string): boolean {
  return APPROVALS.includes(answer.trim().toLowerCase().replace(/[.!]+$/, ''));
}

export const PLAN_INTENT = 'approve-plan';
export const PLAN_PHASE = 'software-architect';

/** The minimum of an exchange this module needs; HumanExchange from human.ts fits. */
interface Exchange {
  phase: string;
  request: { intent: string };
  answer?: { value: string };
  consumed?: boolean;
}

export type PlanReview = 'none' | 'pending' | 'approved' | 'changes';

/**
 * Where the plan review stands, read from the questions asked so far. The newest plan question decides:
 * unanswered is pending; an approval means the current plan is approved (the architect is not run again after one);
 * changes asked for and not yet acted on is `changes`; changes already acted on means a new plan exists and needs a new question.
 */
export function planReview(exchanges: Exchange[] | undefined): PlanReview {
  const asked = (exchanges ?? []).filter(e => e.phase === PLAN_PHASE && e.request.intent === PLAN_INTENT);
  const last = asked[asked.length - 1];
  if (!last) return 'none';
  if (!last.answer) return 'pending';
  if (isApproval(last.answer.value)) return 'approved';
  return last.consumed ? 'none' : 'changes';
}

/** Marks the newest plan question as acted on. */
export function consumePlanChanges<E extends Exchange>(exchanges: E[] | undefined): E[] | undefined {
  if (!exchanges) return exchanges;
  const index = exchanges.map(e => e.phase === PLAN_PHASE && e.request.intent === PLAN_INTENT).lastIndexOf(true);
  return exchanges.map((e, i) => (i === index ? { ...e, consumed: true } : e));
}

export interface PlanDeviations {
  /** In the plan, not produced by any builder. */
  missing: string[];
  /** Produced, but not in the plan. */
  unplanned: string[];
}

/** Paths from the `generated_files` lists of builder outputs. Entries without a usable path are skipped. */
export function builtPaths(builderOutputs: Array<Record<string, unknown> | null | undefined>): string[] {
  const paths = new Set<string>();
  for (const out of builderOutputs) {
    const list = out && (out as Record<string, unknown>).generated_files;
    if (!Array.isArray(list)) continue;
    for (const f of list) {
      const raw = isString(f) ? f : isRecord(f) && isString(f.path) ? f.path : null;
      const clean = raw === null ? null : normalizePath(raw);
      if (clean) paths.add(clean);
    }
  }
  return [...paths].sort();
}

export function planDeviations(plan: ImplementationPlan, built: string[]): PlanDeviations {
  const planned = new Set(plan.phases.flatMap(p => p.files));
  const have = new Set(built);
  return {
    missing: [...planned].filter(f => !have.has(f)).sort(),
    unplanned: [...have].filter(f => !planned.has(f)).sort()
  };
}

export function renderDeviations(d: PlanDeviations, limit = 20): string {
  if (d.missing.length === 0 && d.unplanned.length === 0) return 'The built files match the plan.';
  const list = (label: string, files: string[]): string =>
    files.length === 0 ? '' : `${label} (${files.length}): ${files.slice(0, limit).join(', ')}${files.length > limit ? ', ...' : ''}`;
  return [list('Planned but not built', d.missing), list('Built but not in the plan', d.unplanned)].filter(Boolean).join('. ');
}

/** The commands to run after the build: every automated check in the plan, in order, without repeats. */
export function automatedChecks(plan: ImplementationPlan): string[] {
  return [...new Set(plan.phases.flatMap(p => p.automated_checks))];
}

/** A small valid plan for mocks and tests. */
export function stubPlan(): ImplementationPlan {
  return {
    phases: [{
      name: 'Skeleton',
      goal: 'The app starts and answers a health check',
      serves: [],
      files: ['src/server.ts'],
      automated_checks: ['npm test'],
      manual_checks: []
    }],
    modules: [{
      name: 'Server',
      purpose: 'Accepts requests and answers them',
      interface: ['GET /health'],
      hides: 'Routing, startup and shutdown',
      boundary_tests: ['GET /health returns 200']
    }],
    assumed_changes: [],
    futures: []
  };
}
