import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readEvents, replay, stateDifferences } from '../../events';
import { handoffPath } from '../../handoff';
import { pendingExchange, recordAnswer } from '../../human';
import { FactoryOrchestrator } from '../../orchestrator';
import { AGENT_NAMES } from '../../pipeline';
import { WorkflowState, loadWorkflowState, readSnapshot, saveWorkflowState } from '../../state';
import { Scenario, conformingInvoker } from '../mock-agent';
import { copyDeclarations, writeSampleProject } from '../sample-project';
import { Check, Ctx, Result, fail, pass } from '../types';

const BRIEF = 'Verification run: a small invoicing app so customers can pay on time';
const bullets = (items: string[]): string => items.map(i => `- ${i}`).join('\n');

/** Runs `body` inside a throwaway project directory with the environment a model-free run needs, then restores both. */
async function inProject<T>(prepare: (dir: string) => void, env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-verify-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-verify-data-'));
  const saved = { cwd: process.cwd(), env: { ...process.env }, console: { log: console.log, info: console.info, debug: console.debug, warn: console.warn } };
  try {
    prepare(dir);
    // The orchestrator logs to the console; the report is the output here
    console.log = console.info = console.debug = console.warn = () => {};
    for (const k of Object.keys(process.env)) if (/^(GITHUB_|FACTORY_)/.test(k)) delete process.env[k];
    Object.assign(process.env, { FACTORY_DATA_DIR: data, FACTORY_IGNORE_WIP: '1', FACTORY_PLAN_APPROVAL: '0', ...env });
    process.chdir(dir);
    return await body();
  } finally {
    Object.assign(console, saved.console);
    process.chdir(saved.cwd);
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved.env);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
}

const orchestrator = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, { maxRetries: 1, backoffMs: 1 });
const sample = (ctx: Ctx) => (dir: string) => writeSampleProject(dir, ctx.factoryRoot);
const gate = (state: WorkflowState, agent: string) => state.phases.filter(p => p.phase === agent).pop();
const notes = (state: WorkflowState) => state.notes.slice(-6).join('\n');

function scenario(id: string, title: string, run: (ctx: Ctx) => Promise<string | Result>): Check {
  return {
    id,
    tier: 'mock',
    title,
    run: async ctx => {
      try {
        const r = await run(ctx);
        return typeof r === 'string' ? pass(r) : r;
      } catch (e) {
        return fail(`threw: ${(e as Error).message}`, (e as Error).stack?.split('\n').slice(0, 8).join('\n'));
      }
    }
  };
}

export const mockChecks: Check[] = [
  scenario('mock.full-run', 'All 10 agents run in order, and each gets the declarations meant for it', ctx => inProject(sample(ctx), {}, async () => {
    const { invoker, calls, inputsOf } = conformingInvoker();
    const state = await orchestrator(invoker).executeWorkflow(BRIEF);
    const problems: string[] = [];
    if (state.status !== 'completed') problems.push(`status is ${state.status}, expected completed`);
    for (const a of AGENT_NAMES) if (!gate(state, a)?.valid) problems.push(`${a} has no valid gate`);
    const has = (agent: string, key: string) => inputsOf(agent).some(i => key in i);
    const expect: Array<[string, string, boolean]> = [
      ['product-manager', 'mission', true], ['software-architect', 'mission', true], ['reviewer', 'mission', true],
      ['frontend-engineer', 'lookfeel', true], ['frontend-engineer', 'character', true], ['customer-support', 'character', true],
      ['reviewer', 'lookfeel', true], ['reviewer', 'character', true],
      ['product-manager', 'language', true], ['backend-engineer', 'language', true], ['reviewer', 'language', true],
      ['infrastructure-engineer', 'mission', false], ['infrastructure-engineer', 'character', false]
    ];
    for (const [agent, key, want] of expect) if (has(agent, key) !== want) problems.push(`${agent} ${want ? 'was not given' : 'was given'} "${key}"`);
    const tokens = state.tokensUsed ?? 0;
    if (tokens !== calls.length * 100) problems.push(`tokensUsed is ${tokens}, expected ${calls.length * 100} for ${calls.length} calls`);
    const { events } = readEvents(state.id);
    const rebuilt = replay(events);
    const saved = readSnapshot(state.id);
    const diff = rebuilt && saved ? stateDifferences(rebuilt, saved) : ['no event log or snapshot'];
    if (diff.length) problems.push(`the event log does not replay to the saved state: ${diff.join(', ')}`);
    if (!fs.existsSync(handoffPath(state.id)) && state.status !== 'completed') problems.push('a stopped run left no handoff file');
    return problems.length === 0
      ? `completed in ${calls.length} agent calls; mission, character, look and feel and language reached the right agents; ${events.length} events replay to the saved state`
      : fail(`${problems.length} problem(s)`, `${bullets(problems)}\n\nLast notes:\n${notes(state)}`, 'Run `npx jest .factory/__tests__/orchestrator.test.ts` and read the first failure');
  })),

  scenario('mock.project-declarations', 'The project\'s own declarations let a run start and finish', ctx => inProject(dir => {
    const copied = copyDeclarations(ctx.projectDir, dir);
    if (!copied.includes('project.config.json')) fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({ name: 'verify', mcp_servers: {} }));
  }, {}, async () => {
    const { invoker } = conformingInvoker();
    const state = await orchestrator(invoker).executeWorkflow(BRIEF);
    return state.status === 'completed'
      ? `completed with the project's MISSION.md, CHARACTER.md, LOOKFEEL.md and glossary where present (${state.notes.filter(n => /loaded|No (mission|character|look)/i.test(n)).length} declaration note(s))`
      : fail(`the run ended ${state.status}`, notes(state), 'A declaration the project has is unusable: see the project.* checks above, or read the notes here');
  })),

  scenario('mock.plan-approval', 'The build waits for a person to approve the plan, then continues', ctx => inProject(sample(ctx), { FACTORY_PLAN_APPROVAL: '1' }, async () => {
    const { invoker, calls } = conformingInvoker();
    const paused = await orchestrator(invoker).executeWorkflow(BRIEF);
    const waiting = pendingExchange(paused.humanRequests);
    if (paused.status !== 'paused' || !waiting) return fail(`expected a pause for approval, the run is ${paused.status}`, notes(paused));
    if (calls.some(c => c.agent === 'backend-engineer')) return fail('a builder ran before the plan was approved');
    const answered = recordAnswer(paused.humanRequests, 'approve', 'verify');
    saveWorkflowState({ ...paused, humanRequests: answered ?? paused.humanRequests });
    const resumed = await orchestrator(invoker).executeWorkflow(paused.issueBrief, paused.issueNumber, paused.config, loadWorkflowState(paused.id)!);
    return resumed.status === 'completed' ? 'paused with the plan as a question; builders started only after "approve"' : fail(`after approval the run is ${resumed.status}`, notes(resumed));
  })),

  scenario('mock.repair', 'A reply that breaks its contract is re-asked once with what was wrong', ctx => inProject(sample(ctx), {}, async () => {
    const { invoker, inputsOf } = conformingInvoker({ malformedOnce: 'analyzer' });
    const state = await orchestrator(invoker).executeWorkflow(BRIEF);
    const asks = inputsOf('analyzer');
    if (state.status !== 'completed') return fail(`the run is ${state.status}`, notes(state));
    if (asks.length !== 2 || !('repair' in asks[1])) return fail(`the analyzer was called ${asks.length} time(s) and the second call ${asks[1] && 'repair' in asks[1] ? 'had' : 'had no'} repair note`);
    return 'the analyzer was asked twice; the second call carried the problem; the run completed';
  })),

  scenario('mock.failure-retry', 'A declined phase stops the run with a handoff, and retry resumes without redoing finished work', ctx => inProject(sample(ctx), { FACTORY_MAX_REPAIRS: '0' }, async () => {
    const { invoker, inputsOf } = conformingInvoker({ declineOnce: 'backend-engineer' });
    const failed = await orchestrator(invoker).executeWorkflow(BRIEF);
    if (failed.status !== 'failed') return fail(`expected the run to fail, it is ${failed.status}`, notes(failed));
    if (!fs.existsSync(handoffPath(failed.id))) return fail('the stopped run left no handoff file');
    const before = inputsOf('product-manager').length;
    const resumed = await orchestrator(invoker).executeWorkflow(failed.issueBrief, failed.issueNumber, failed.config, loadWorkflowState(failed.id)!);
    if (resumed.status !== 'completed') return fail(`retry ended ${resumed.status}`, notes(resumed));
    if (inputsOf('product-manager').length !== before) return fail('retry ran the product manager again; validated phases should be kept');
    return 'failed at the builders with a handoff file; retry kept the finished phases and completed';
  })),

  scenario('mock.needs-human', 'An agent can ask a person a question, pause, and continue with the answer', ctx => inProject(sample(ctx), {}, async () => {
    const { invoker, inputsOf } = conformingInvoker({ askOnce: 'analyzer' });
    const paused = await orchestrator(invoker).executeWorkflow(BRIEF);
    const waiting = pendingExchange(paused.humanRequests);
    if (paused.status !== 'paused' || !waiting) return fail(`expected a pause with a question, the run is ${paused.status}`, notes(paused));
    saveWorkflowState({ ...paused, humanRequests: recordAnswer(paused.humanRequests, 'a', 'verify') ?? paused.humanRequests });
    const resumed = await orchestrator(invoker).executeWorkflow(paused.issueBrief, paused.issueNumber, paused.config, loadWorkflowState(paused.id)!);
    const given = inputsOf('analyzer').some(i => Array.isArray(i.humanAnswers) && i.humanAnswers.length > 0);
    return resumed.status === 'completed' && given ? 'paused on the analyzer\'s question; the answer reached it on the next call; completed' : fail(`after the answer the run is ${resumed.status}; answer handed over: ${given}`, notes(resumed));
  })),

  scenario('mock.token-cap', 'The token cap pauses the run before the next stage, and raising it resumes', ctx => inProject(sample(ctx), { FACTORY_MAX_TOKENS: '150' }, async () => {
    const { invoker } = conformingInvoker();
    const paused = await orchestrator(invoker).executeWorkflow(BRIEF);
    if (paused.status !== 'paused' || !paused.notes.some(n => /Token budget reached/.test(n))) return fail(`expected a pause at the cap, the run is ${paused.status}`, notes(paused));
    process.env.FACTORY_MAX_TOKENS = '0';
    const resumed = await orchestrator(invoker).executeWorkflow(paused.issueBrief, paused.issueNumber, paused.config, loadWorkflowState(paused.id)!);
    return resumed.status === 'completed' ? `paused after ${paused.tokensUsed} tokens against a cap of 150; completed once the cap was lifted` : fail(`after lifting the cap the run is ${resumed.status}`, notes(resumed));
  }))
];
