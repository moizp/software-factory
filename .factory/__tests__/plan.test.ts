import { stubPayload, validateContract } from '../contracts';
import { recordAnswer } from '../human';
import { FactoryOrchestrator } from '../orchestrator';
import {
  PLAN_INTENT, automatedChecks, builtPaths, consumePlanChanges, hasTestFile, isApproval, normalizePath, parsePlan, planDeviations,
  planReview, renderDeviations, renderPlanSummary, stubPlan
} from '../plan';
import { retryConfig } from './fixtures';

const phase = (over: Record<string, unknown> = {}) => ({
  name: 'Auth', goal: 'People can log in', files: ['src/auth.ts', './src/routes//login.ts'],
  automated_checks: ['npm test'], manual_checks: ['Password rules read well'], ...over
});
const plan = (...phases: unknown[]) => ({ ...stubPlan(), phases });

describe('parsePlan', () => {
  it('accepts a plan and cleans it up', () => {
    const r = parsePlan(plan(phase({ files: ['src/a.ts', { path: './src/b.ts' }, 'src/a.ts'], automated_checks: [{ command: 'npm test' }, 'npx tsc'] })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.phases[0].files).toEqual(['src/a.ts', 'src/b.ts']);
      expect(r.plan.phases[0].automated_checks).toEqual(['npm test', 'npx tsc']);
    }
  });
  it('needs an automated check in every phase, and accepts a phase without manual ones', () => {
    expect(parsePlan(plan(phase({ manual_checks: undefined }))).ok).toBe(true);
    const manualOnly = parsePlan(plan(phase({ automated_checks: undefined })));
    expect(manualOnly.ok).toBe(false);
    expect((manualOnly as any).error).toContain('phases[0] needs at least one command in automated_checks');
    expect(parsePlan(plan(phase({ automated_checks: [], manual_checks: ['look at it'] }))).ok).toBe(false);
  });
  it('rejects what a person could not review', () => {
    const bad: unknown[] = [
      null, 'plan', [], {}, { phases: [] }, { phases: 'x' }, plan('not a phase'),
      plan(phase({ name: '' })), plan(phase({ name: 5 })), plan(phase({ goal: 5 })),
      plan(phase({ files: [] })), plan(phase({ files: 'src/a.ts' })), plan(phase({ files: [5] })),
      plan(phase({ files: ['/etc/passwd'] })), plan(phase({ files: ['../outside.ts'] })), plan(phase({ files: ['a/../../b.ts'] })), plan(phase({ files: ['C:\\x.ts'] })),
      plan(phase({ automated_checks: [''] })), plan(phase({ automated_checks: 'npm test' })), plan(phase({ automated_checks: ['x'.repeat(301)] })),
      plan(phase({ files: Array.from({ length: 16 }, (_, i) => `f${i}.ts`) })),
      { phases: Array.from({ length: 13 }, () => phase()) }
    ];
    for (const b of bad) expect(parsePlan(b).ok).toBe(false);
  });
  it('says where the problem is', () => {
    expect((parsePlan(plan(phase(), phase({ files: [] }))) as any).error).toContain('phases[1].files');
  });
});

describe('paths', () => {
  it('normalises relative paths and refuses the rest', () => {
    expect(normalizePath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizePath('src\\a.ts')).toBe('src/a.ts');
    for (const bad of ['', '  ', '/abs', '../up', 'a/../b', 'C:/x']) expect(normalizePath(bad)).toBeNull();
  });
});

describe('summary and approval words', () => {
  const p = (parsePlan(plan(phase(), phase({ name: 'Billing', files: Array.from({ length: 10 }, (_, i) => `src/b${i}.ts`) }))) as any).plan;
  it('lists phases, files and both kinds of checks', () => {
    const md = renderPlanSummary(p);
    expect(md).toContain('1. **Auth**: People can log in');
    expect(md).toContain('Automated: `npm test`');
    expect(md).toContain('Manual: Password rules read well');
    expect(md).toContain('and 2 more');
  });
  it('cuts at a line boundary with a note when too long', () => {
    const md = renderPlanSummary(p, 200);
    expect(md.length).toBeLessThanOrEqual(200);
    expect(md).toContain('The rest of the plan is in the workflow state');
  });
  it('takes plain approvals and treats anything else as changes', () => {
    for (const a of ['approve', ' Approved. ', 'YES', 'lgtm', 'Looks good!', 'go ahead']) expect(isApproval(a)).toBe(true);
    for (const a of ['approve but split auth', 'no', 'change the database', '']) expect(isApproval(a)).toBe(false);
  });
});

describe('comparing with what was built', () => {
  const p = (parsePlan(plan(phase({ files: ['src/a.ts', 'src/b.ts'] }), phase({ name: 'Two', files: ['src/c.ts'] }))) as any).plan;
  it('reads builder file lists, however they are written', () => {
    expect(builtPaths([{ generated_files: [{ path: './src/a.ts' }, 'src/x.ts', { path: '../bad' }, { nopath: 1 }] }, null, {}, { generated_files: 'no' }, { generated_files: [{ path: 'src/a.ts' }] }]))
      .toEqual(['src/a.ts', 'src/x.ts']);
  });
  it('finds what is missing and what was not planned', () => {
    const d = planDeviations(p, ['src/a.ts', 'src/z.ts']);
    expect(d).toEqual({ missing: ['src/b.ts', 'src/c.ts'], unplanned: ['src/z.ts'] });
    expect(renderDeviations(d)).toBe('Planned but not built (2): src/b.ts, src/c.ts. Built but not in the plan (1): src/z.ts');
    expect(renderDeviations(planDeviations(p, ['src/a.ts', 'src/b.ts', 'src/c.ts']))).toBe('The built files match the plan.');
  });
  it('lists automated checks once, in order', () => {
    const q = (parsePlan(plan(phase({ automated_checks: ['a', 'b'] }), phase({ automated_checks: ['b', 'c'] }))) as any).plan;
    expect(automatedChecks(q)).toEqual(['a', 'b', 'c']);
  });
});

describe('planReview', () => {
  const ex = (answer?: string, consumed = false, intent = PLAN_INTENT, phase = 'software-architect') =>
    ({ phase, request: { intent }, ...(answer === undefined ? {} : { answer: { value: answer } }), ...(consumed ? { consumed } : {}) });
  it('follows the newest plan question', () => {
    expect(planReview(undefined)).toBe('none');
    expect(planReview([])).toBe('none');
    expect(planReview([ex()])).toBe('pending');
    expect(planReview([ex('approve')])).toBe('approved');
    expect(planReview([ex('split auth')])).toBe('changes');
    expect(planReview([ex('split auth', true)])).toBe('none');
    expect(planReview([ex('split auth', true), ex()])).toBe('pending');
    expect(planReview([ex('split auth', true), ex('approve')])).toBe('approved');
  });
  it('ignores other questions', () => {
    expect(planReview([ex('x', false, 'clarify'), ex('y', false, PLAN_INTENT, 'analyzer')])).toBe('none');
  });
  it('marks only the newest plan question as acted on', () => {
    const out = consumePlanChanges([ex('a', true), ex('b'), ex('c', false, 'clarify')] as any)!;
    expect(out.map(e => e.consumed)).toEqual([true, true, undefined]);
  });
});

describe('the architect contract', () => {
  const reply = (over: Record<string, unknown> = {}) => ({ phase: 'software-architect', valid: true, ...stubPayload('software-architect'), ...over });
  it('a valid reply needs a plan that parses', () => {
    expect(validateContract(reply(), 'software-architect')).toEqual([]);
    expect(validateContract(reply({ implementation_plan: undefined }), 'software-architect').join()).toContain('implementation_plan');
    const bad = validateContract(reply({ implementation_plan: plan(phase({ files: [] })) }), 'software-architect');
    expect(bad.join()).toContain('phases[0].files');
  });
  it('a reply that declines is not held to it', () => {
    const declined = { phase: 'software-architect', valid: false, error: 'No', blockers: [{ component: 'x', error: 'impossible' }] };
    expect(validateContract(declined, 'software-architect')).toEqual([]);
  });
  it('stubs carry a valid plan', () => {
    expect(parsePlan(stubPlan()).ok).toBe(true);
    expect(parsePlan(stubPayload('software-architect').implementation_plan).ok).toBe(true);
  });
});

// ---- whole workflows -------------------------------------------------------------------------------------------

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
const good = (agent: string, extra: Record<string, unknown> = {}) => ({ phase: agent, valid: true, ...stubPayload(agent), ...extra, usage });
const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);

function recorder(overrides: Record<string, (input: Record<string, any>, call: number) => any> = {}) {
  const calls: Array<{ agent: string; input: Record<string, any> }> = [];
  const invoker = async (_s: any, agent: string, input: Record<string, any>) => {
    calls.push({ agent, input });
    const n = calls.filter(c => c.agent === agent).length;
    return overrides[agent] ? overrides[agent](input, n) : good(agent);
  };
  return { invoker, calls, of: (agent: string) => calls.filter(c => c.agent === agent) };
}

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['FACTORY_PLAN_APPROVAL', 'FACTORY_IGNORE_WIP', 'FACTORY_MAX_REPAIRS']) saved[k] = process.env[k];
  process.env.FACTORY_IGNORE_WIP = '1';
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const answer = (state: any, value: string) => ({ ...state, humanRequests: recordAnswer(state.humanRequests, value, 'alice')! });

describe('plan approval', () => {
  it('does nothing unless it is switched on', async () => {
    const r = recorder();
    const s = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'backend-engineer' });
    expect(s.humanRequests).toBeUndefined();
    expect(r.of('backend-engineer')).toHaveLength(1);
  });

  it('pauses after the architect with the plan as the question, before any builder runs', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    const r = recorder();
    const s = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(s.status).toBe('paused');
    expect(r.of('backend-engineer')).toHaveLength(0);
    const q = s.humanRequests![0];
    expect(q).toMatchObject({ phase: 'software-architect', request: { intent: PLAN_INTENT, format: 'free_text' } });
    expect(q.request.context).toContain('Skeleton');
    expect(q.request.context).toContain('Automated: `npm test`');
    expect(s.notes.some(n => n.includes('needs approval'))).toBe(true);
    expect(s.phases.find(p => p.phase === 'software-architect')!.valid).toBe(true);
  });

  it('can be switched on in the workflow config', async () => {
    const r = recorder();
    const s = await orch(r.invoker).executeWorkflow('Build', 1, { plan_approval: true }, undefined, { until: 'reviewer' });
    expect(s.status).toBe('paused');
    expect(r.of('backend-engineer')).toHaveLength(0);
  });

  it('an approval lets the build start and keeps the approved plan', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    const r = recorder();
    const o = orch(r.invoker);
    const paused = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    const done = await o.executeWorkflow('Build', 1, {}, answer(paused, 'approve'), { until: 'reviewer' });
    expect(r.of('software-architect')).toHaveLength(1);
    expect(r.of('backend-engineer')).toHaveLength(1);
    expect(r.of('reviewer')).toHaveLength(1);
    expect(done.humanRequests).toHaveLength(1);
    expect(done.notes.some(n => n.includes('Stopped after reviewer'))).toBe(true);
  });

  it('changes sent back make the architect revise with the answer, then ask again', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    const r = recorder({
      'software-architect': (input, n) => good('software-architect', {
        implementation_plan: plan(phase({ name: n === 1 ? 'Everything at once' : 'Auth first', files: ['src/a.ts'] }))
      })
    });
    const o = orch(r.invoker);
    const first = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(first.humanRequests![0].request.context).toContain('Everything at once');

    const second = await o.executeWorkflow('Build', 1, {}, answer(first, 'Split it: auth first'), { until: 'reviewer' });
    expect(r.of('software-architect')).toHaveLength(2);
    expect(r.of('software-architect')[1].input.humanAnswers).toEqual([
      { question: expect.stringContaining('Approve this implementation plan'), answer: 'Split it: auth first' }
    ]);
    expect(r.of('backend-engineer')).toHaveLength(0);
    expect(second.status).toBe('paused');
    expect(second.humanRequests).toHaveLength(2);
    expect(second.humanRequests![0].consumed).toBe(true);
    expect(second.humanRequests![1].request.context).toContain('Auth first');
    expect(second.humanRequests![1].request.context).not.toContain('Everything at once');

    const third = await o.executeWorkflow('Build', 1, {}, answer(second, 'approve'), { until: 'reviewer' });
    expect(r.of('software-architect')).toHaveLength(2);
    expect(r.of('backend-engineer')).toHaveLength(1);
    expect(third.status).toBe('paused');
    expect(third.notes.some(n => n.includes('Stopped after reviewer'))).toBe(true);
  });

  it('gives up after three rounds', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    const r = recorder();
    const o = orch(r.invoker);
    let state: any = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    for (let round = 1; round <= 2; round++) {
      state = await o.executeWorkflow('Build', 1, {}, answer(state, `change ${round}`), { until: 'reviewer' });
      expect(state.status).toBe('paused');
    }
    state = await o.executeWorkflow('Build', 1, {}, answer(state, 'change 3'), { until: 'reviewer' });
    expect(state.status).toBe('failed');
    expect(state.notes.some((n: string) => n.includes('not approved after 3 rounds'))).toBe(true);
    expect(r.of('backend-engineer')).toHaveLength(0);
  });

  it('asks before an --until stop at the architect, and stops there once approved', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    const r = recorder();
    const o = orch(r.invoker);
    const paused = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'software-architect' });
    expect(pendingExchange(paused)).toBe(true);
    const resumed = await o.executeWorkflow('Build', 1, {}, answer(paused, 'approve'), { until: 'software-architect' });
    expect(r.of('software-architect')).toHaveLength(1);
    expect(r.of('backend-engineer')).toHaveLength(0);
    expect(resumed.notes.some(n => n.includes('Stopped after software-architect'))).toBe(true);
  });
});

const pendingExchange = (s: any) => !!s.humanRequests?.some((e: any) => !e.answer);

describe('the check against the plan', () => {
  it('notes the difference after the build and hands it to the reviewer', async () => {
    const r = recorder({
      'software-architect': () => good('software-architect', { implementation_plan: plan(phase({ files: ['src/a.ts', 'src/b.ts'] })) }),
      'backend-engineer': () => good('backend-engineer', { generated_files: [{ path: 'src/a.ts' }, { path: 'src/extra.ts' }] })
    });
    const s = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(s.notes.some(n => n.endsWith('Plan check: Planned but not built (1): src/b.ts. Built but not in the plan (1): src/extra.ts'))).toBe(true);
    const reviewerInput = r.of('reviewer')[0].input;
    expect(reviewerInput.planCheck).toEqual({
      deviations: { missing: ['src/b.ts'], unplanned: ['src/extra.ts'] },
      automated_checks: ['npm test']
    });
    expect(s.status).toBe('paused');
  });
});

// ---- the principles: deep modules, assumed changes, futures, small steps -----------------------------------------------

describe('modules, assumed changes and futures', () => {
  const mod = (over: Record<string, unknown> = {}) => ({
    name: 'Accounts', purpose: 'Registers people and decides who is signed in', interface: ['register()', 'login()'],
    hides: 'Hashing, sessions and rate limiting', boundary_tests: ['login with a wrong password is refused'], ...over
  });
  const withModules = (modules: unknown) => ({ ...plan(phase()), modules });
  const bad = (raw: unknown) => (parsePlan(raw) as any).error as string;

  it('accepts a plan with modules, assumed changes and futures, and keeps them', () => {
    const r = parsePlan({ ...plan(phase()), modules: [mod()], assumed_changes: [{ change: 'Support resets passwords in the admin page', affects: 'Support team' }], futures: [{ what: 'Merge the two validators', why: 'one rule in one place' }] });
    expect(r.ok && r.plan.modules[0].name).toBe('Accounts');
    expect(r.ok && r.plan.assumed_changes).toEqual([{ change: 'Support resets passwords in the admin page', affects: 'Support team' }]);
    expect(r.ok && r.plan.futures).toHaveLength(1);
  });
  it('needs the three keys to be present, though the last two may be empty', () => {
    expect(bad({ phases: plan(phase()).phases })).toContain('implementation_plan.modules must list');
    expect(bad({ phases: plan(phase()).phases, modules: [mod()], futures: [] })).toContain('assumed_changes must be a list');
    expect(bad({ phases: plan(phase()).phases, modules: [mod()], assumed_changes: [] })).toContain('futures must be a list');
    expect(parsePlan({ phases: plan(phase()).phases, modules: [mod()], assumed_changes: [], futures: [] }).ok).toBe(true);
  });
  it('holds a module to a deep shape: a small interface, something hidden, a boundary test', () => {
    expect(bad(withModules([]))).toContain('modules must list');
    expect(bad(withModules([mod({ interface: Array.from({ length: 8 }, (_, i) => `f${i}()`) })]))).toContain('has 8 entries; a deep module has at most 7');
    expect(bad(withModules([mod({ interface: [] })]))).toContain('interface must list');
    expect(bad(withModules([mod({ hides: 'x' })]))).toContain('hides must say what is kept inside');
    expect(bad(withModules([mod({ boundary_tests: [] })]))).toContain('boundary_tests must list at least one');
    expect(bad(withModules([mod({ purpose: '' })]))).toContain('purpose');
    expect(bad(withModules([mod(), mod({ name: 'accounts' })]))).toContain('is used twice');
    expect(bad(withModules(Array.from({ length: 13 }, (_, i) => mod({ name: `M${i}` }))))).toContain('more than 12 modules');
    expect(bad(withModules(['x']))).toContain('modules[0] must be an object');
  });
  it('describes malformed assumed changes and futures precisely', () => {
    expect(bad({ ...withModules([mod()]), assumed_changes: [{ change: 'x' }], futures: [] })).toContain('assumed_changes[0]');
    expect(bad({ ...withModules([mod()]), assumed_changes: [], futures: [{ what: 'refactor' }] })).toContain('futures[0]');
  });
  it('is required by the architect contract, and the stub plan satisfies it', () => {
    const reply = (p: unknown) => ({ phase: 'software-architect', valid: true, ...stubPayload('software-architect'), implementation_plan: p });
    expect(validateContract(reply(stubPlan()), 'software-architect')).toEqual([]);
    const { modules, ...without } = stubPlan();
    expect(validateContract(reply(without), 'software-architect').join()).toContain('modules');
  });
  it('shows the person approving the modules, the assumed changes and the futures', () => {
    const r = parsePlan({ ...plan(phase()), modules: [mod()], assumed_changes: [{ change: 'Support resets passwords in the admin page', affects: 'Support team' }], futures: [{ what: 'Merge the two validators', why: 'one rule in one place' }] });
    const text = renderPlanSummary((r as any).plan);
    expect(text).toContain('Modules (1): Accounts [register(), login()]');
    expect(text).toContain('Assumed changes to how people work: Support resets passwords in the admin page (affects Support team)');
    expect(text).toContain('Futures proposed: Merge the two validators (one rule in one place)');
    const none = renderPlanSummary(parsePlan(plan(phase()))!.ok ? (parsePlan(plan(phase())) as any).plan : stubPlan());
    expect(none).toContain('Assumed changes to how people work: none');
    expect(none).toContain('Futures proposed: none');
  });
  it('says which steps have no test file planned', () => {
    expect(hasTestFile(['src/a.ts', 'src/a.test.ts'])).toBe(true);
    expect(hasTestFile(['src/__tests__/a.ts'])).toBe(true);
    expect(hasTestFile(['tests/a.py'])).toBe(true);
    expect(hasTestFile(['src/a_test.go'])).toBe(true);
    expect(hasTestFile(['src/a.ts', 'src/contest.ts'])).toBe(false);
    const p = (parsePlan(plan(phase({ files: ['src/a.ts'] }), phase({ name: 'B', files: ['src/b.ts', 'src/b.spec.ts'] }))) as any).plan;
    const text = renderPlanSummary(p);
    expect(text.match(/No test file is planned in this step/g)).toHaveLength(1);
  });
});

describe('the reviewer as a sceptic', () => {
  const reply = (review: unknown) => ({ phase: 'reviewer', valid: true, ...stubPayload('reviewer'), review });
  it('must say what it tried to find wrong', () => {
    expect(validateContract(reply({ status: 'approved' }), 'reviewer')[0]).toContain('review.challenges');
    expect(validateContract(reply({ challenges: [] }), 'reviewer')[0]).toContain('review.challenges');
    expect(validateContract(reply({ challenges: ['ok'] }), 'reviewer')[0]).toContain('review.challenges');
    expect(validateContract(reply({ challenges: ['Looked for failure paths and duplicated validation'] }), 'reviewer')).toEqual([]);
  });
  it('is not asked when it declines', () => {
    expect(validateContract({ phase: 'reviewer', valid: false, error: 'nothing to review', blockers: [{ a: 1 }] }, 'reviewer')).toEqual([]);
  });
  it('is satisfied by the contract stub', () => {
    expect(validateContract({ phase: 'reviewer', valid: true, ...stubPayload('reviewer') }, 'reviewer')).toEqual([]);
  });
});
