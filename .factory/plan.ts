/**
 * The architect's implementation plan: ordered phases, each with the files it touches and the checks that show it is
 * done, split into automated (commands) and manual (things a person looks at). A person reviews this plan before
 * anything is built, and after the build the files that were produced are compared with it.
 * Everything here is pure: checking the shape, summarising for a person, and comparing with what was built.
 */

export interface PlanPhase {
  name: string;
  goal?: string;
  files: string[];
  automated_checks: string[];
  manual_checks: string[];
}

export interface ImplementationPlan {
  phases: PlanPhase[];
}

const MAX_PHASES = 12;
const MAX_FILES_PER_PHASE = 60;
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
export function parsePlan(raw: unknown): Parsed {
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
    const automated = checkList(p.automated_checks, `${where}.automated_checks`);
    if (!automated.ok) return automated;
    const manual = checkList(p.manual_checks, `${where}.manual_checks`);
    if (!manual.ok) return manual;
    if (automated.checks.length + manual.checks.length === 0) {
      return { ok: false, error: `${where} needs at least one check in automated_checks or manual_checks, or nobody can tell when it is done` };
    }
    out.push({
      name: p.name.trim(),
      ...(isString(p.goal) && p.goal.trim() ? { goal: p.goal.trim() } : {}),
      files: files.files,
      automated_checks: automated.checks,
      manual_checks: manual.checks
    });
  }
  return { ok: true, plan: { phases: out } };
}

/** The plan as a person reads it: phases, files and checks. Cut at `maxChars` with a note, never mid-line. */
export function renderPlanSummary(plan: ImplementationPlan, maxChars = 6000): string {
  const lines: string[] = [];
  plan.phases.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.name}**${p.goal ? `: ${p.goal}` : ''}`);
    lines.push(`   - Files (${p.files.length}): ${p.files.slice(0, 8).join(', ')}${p.files.length > 8 ? `, and ${p.files.length - 8} more` : ''}`);
    p.automated_checks.forEach(c => lines.push(`   - Automated: \`${c}\``));
    p.manual_checks.forEach(c => lines.push(`   - Manual: ${c}`));
  });
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
      files: ['src/server.ts'],
      automated_checks: ['npm test'],
      manual_checks: []
    }]
  };
}
