import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAgentPrompt } from '../claude-bridge';
import { stubPayload } from '../contracts';
import {
  HumanExchange, HumanRequest, MAX_QUESTIONS_PER_PHASE, answersFor, newExchange, parseRequest, pendingExchange,
  questionsAsked, recordAnswer, renderQuestion, validateAnswer
} from '../human';
import { FactoryOrchestrator } from '../orchestrator';
import { WorkflowState, createWorkflowState, saveWorkflowState } from '../state';
import { createMockWorkflowState, retryConfig } from './fixtures';

const ask = (over: Record<string, unknown> = {}) => ({ question: 'Which database?', ...over });
const req = (over: Partial<HumanRequest> = {}): HumanRequest => ({ intent: 'clarify', question: 'Q?', urgency: 'medium', format: 'free_text', ...over });

describe('parseRequest', () => {
  it('fills the defaults', () => {
    const r = parseRequest(ask());
    expect(r).toEqual({ ok: true, request: { intent: 'clarify', question: 'Which database?', urgency: 'medium', format: 'free_text' } });
  });
  it('keeps what was given and trims it', () => {
    const r = parseRequest(ask({ intent: ' approve ', context: ' why ', urgency: 'high', format: 'yes_no', question: '  Deploy?  ' }));
    expect(r).toMatchObject({ ok: true, request: { intent: 'approve', context: 'why', urgency: 'high', format: 'yes_no', question: 'Deploy?' } });
  });
  it('needs two to eight different choices for multiple choice, and ignores choices otherwise', () => {
    const choices = ['Postgres', 'MySQL'];
    expect(parseRequest(ask({ format: 'multiple_choice', choices }))).toMatchObject({ ok: true, request: { choices } });
    expect(parseRequest(ask({ format: 'free_text', choices }))).toMatchObject({ ok: true });
    expect((parseRequest(ask({ format: 'free_text', choices })) as any).request.choices).toBeUndefined();
    for (const bad of [undefined, [], ['one'], ['a', ''], ['a', 'A'], Array.from({ length: 9 }, (_, i) => `c${i}`), ['a', 5]]) {
      expect(parseRequest(ask({ format: 'multiple_choice', choices: bad })).ok).toBe(false);
    }
  });
  it('rejects what a person could not act on', () => {
    for (const bad of [null, 'text', [], {}, { question: '' }, { question: '   ' }, { question: 5 }, ask({ question: 'x'.repeat(1001) }),
      ask({ urgency: 'asap' }), ask({ format: 'essay' }), ask({ context: 5 }), ask({ context: 'x'.repeat(2001) }), ask({ intent: 5 })]) {
      expect(parseRequest(bad).ok).toBe(false);
    }
  });
  it('says what is wrong', () => {
    expect((parseRequest(ask({ urgency: 'asap' })) as any).error).toContain('urgency');
  });
});

describe('validateAnswer', () => {
  it('free text: anything non-empty and not huge', () => {
    expect(validateAnswer(req(), '  Use Postgres  ')).toEqual({ ok: true, value: 'Use Postgres' });
    expect(validateAnswer(req(), '   ').ok).toBe(false);
    expect(validateAnswer(req(), 'x'.repeat(4001)).ok).toBe(false);
  });
  it('yes or no, in the usual spellings', () => {
    const r = req({ format: 'yes_no' });
    for (const y of ['yes', 'Y', 'Approve', 'OK.', 'true']) expect(validateAnswer(r, y)).toEqual({ ok: true, value: 'yes' });
    for (const n of ['no', 'N', 'Reject', 'deny!', 'false']) expect(validateAnswer(r, n)).toEqual({ ok: true, value: 'no' });
    for (const bad of ['maybe', 'yes please do it', '']) expect(validateAnswer(r, bad).ok).toBe(false);
  });
  it('multiple choice by number or by text, normalised to the option text', () => {
    const r = req({ format: 'multiple_choice', choices: ['Postgres', 'MySQL', 'SQLite'] });
    expect(validateAnswer(r, '2')).toEqual({ ok: true, value: 'MySQL' });
    expect(validateAnswer(r, ' sqlite ')).toEqual({ ok: true, value: 'SQLite' });
    for (const bad of ['0', '4', 'Oracle', '1.5']) expect(validateAnswer(r, bad).ok).toBe(false);
    expect((validateAnswer(r, '9') as any).error).toContain('1 to 3');
  });
});

describe('exchanges', () => {
  const asked = newExchange('analyzer', req({ question: 'First?' }), undefined, new Date('2026-10-18T10:00:00Z'));
  it('numbers questions per phase', () => {
    expect(asked.id).toBe('analyzer-1');
    expect(newExchange('analyzer', req(), [asked]).id).toBe('analyzer-2');
    expect(newExchange('reviewer', req(), [asked]).id).toBe('reviewer-1');
    expect(questionsAsked([asked], 'analyzer')).toBe(1);
    expect(questionsAsked(undefined, 'analyzer')).toBe(0);
  });
  it('records the answer on the one waiting, and only then', () => {
    expect(pendingExchange([asked])).toBe(asked);
    const done = recordAnswer([asked], 'Postgres', 'alice', new Date('2026-10-18T11:00:00Z'))!;
    expect(done[0].answer).toEqual({ value: 'Postgres', by: 'alice', answeredAt: '2026-10-18T11:00:00.000Z' });
    expect(pendingExchange(done)).toBeUndefined();
    expect(recordAnswer(done, 'again', undefined)).toBeNull();
    expect(recordAnswer(undefined, 'x', undefined)).toBeNull();
    expect(asked.answer).toBeUndefined();
  });
  it('gives an agent only its own answered questions', () => {
    const a = { ...asked, answer: { value: 'Postgres', answeredAt: '' } };
    const other: HumanExchange = { ...newExchange('reviewer', req({ question: 'Other?' }), undefined), answer: { value: 'x', answeredAt: '' } };
    const open = newExchange('analyzer', req({ question: 'Open?' }), [a]);
    expect(answersFor([a, other, open], 'analyzer')).toEqual([{ question: 'First?', answer: 'Postgres' }]);
    expect(answersFor(undefined, 'analyzer')).toEqual([]);
  });
  it('renders each format with how to answer', () => {
    const yn = renderQuestion(newExchange('analyzer', req({ format: 'yes_no', context: 'Because.' }), undefined), 'wf-1');
    expect(yn).toContain('Answer yes or no.');
    expect(yn).toContain('Because.');
    expect(yn).toContain('wf-1');
    const mc = renderQuestion(newExchange('analyzer', req({ format: 'multiple_choice', choices: ['A', 'B'] }), undefined), 'wf-1');
    expect(mc).toContain('1. A');
    expect(mc).toContain('2. B');
    expect(renderQuestion(newExchange('analyzer', req(), undefined), 'wf-1')).toContain('in your own words');
  });
});

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
const good = (agent: string) => ({ phase: agent, valid: true, ...stubPayload(agent), usage });
const asks = (agent: string, needs: unknown = ask()) => ({ phase: agent, valid: false, needs_human: needs, usage });

function scripted(replies: Array<any | ((input: Record<string, any>) => any)>) {
  const inputs: Array<Record<string, any>> = [];
  const invoker = async (_s: any, _a: string, input: Record<string, any>) => {
    inputs.push(input);
    const r = replies[Math.min(inputs.length - 1, replies.length - 1)];
    return typeof r === 'function' ? r(input) : r;
  };
  return { invoker, inputs };
}
const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['FACTORY_MAX_REPAIRS', 'FACTORY_IGNORE_WIP', 'FACTORY_DATA_DIR']) savedEnv[k] = process.env[k];
  delete process.env.FACTORY_MAX_REPAIRS;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('pausing for a person', () => {
  it('records the question, pauses, and does not re-ask the agent', async () => {
    const { invoker, inputs } = scripted([asks('analyzer', ask({ format: 'yes_no', urgency: 'high' }))]);
    const state = await orch(invoker).executeSequentialPhase(createMockWorkflowState(), 'analyzer', 'analyzer', {});
    expect(inputs).toHaveLength(1);
    expect(state.status).toBe('paused');
    expect(state.phases[0].valid).toBe(false);
    expect(state.phases[0].error).toBe('Waiting for a person: Which database?');
    expect(state.humanRequests).toHaveLength(1);
    expect(state.humanRequests![0]).toMatchObject({ id: 'analyzer-1', phase: 'analyzer', request: { format: 'yes_no', urgency: 'high' } });
    expect(state.tokensUsed).toBe(100);
    expect(state.notes.some(n => n.includes('asked a person (high urgency)'))).toBe(true);
  });

  it('asks the agent to fix a malformed question like any other bad reply', async () => {
    const { invoker, inputs } = scripted([asks('analyzer', ask({ urgency: 'asap' })), asks('analyzer', ask())]);
    const state = await orch(invoker).executeSequentialPhase(createMockWorkflowState(), 'analyzer', 'analyzer', {});
    expect(inputs).toHaveLength(2);
    expect(inputs[1].repair.problem).toContain('needs_human is not valid');
    expect(state.humanRequests).toHaveLength(1);
    expect(state.status).toBe('paused');
  });

  it('a question with no text is caught by the contract', async () => {
    const { invoker, inputs } = scripted([{ phase: 'analyzer', valid: false, needs_human: {} }, asks('analyzer')]);
    const state = await orch(invoker).executeSequentialPhase(createMockWorkflowState(), 'analyzer', 'analyzer', {});
    expect(inputs).toHaveLength(2);
    expect(state.humanRequests).toHaveLength(1);
  });

  it('ignores a question that comes with valid: true', async () => {
    const { invoker } = scripted([{ phase: 'analyzer', valid: true, needs_human: ask(), ...stubPayload('analyzer'), usage }]);
    const state = await orch(invoker).executeSequentialPhase(createMockWorkflowState(), 'analyzer', 'analyzer', {});
    expect(state.phases[0].valid).toBe(true);
    expect(state.humanRequests).toBeUndefined();
    expect(state.status).not.toBe('paused');
  });

  it('stops a phase that keeps asking', async () => {
    const prior: HumanExchange[] = [1, 2, 3].map(n => ({ ...newExchange('analyzer', req({ question: `Q${n}` }), undefined), id: `analyzer-${n}`, answer: { value: 'a', answeredAt: '' } }));
    expect(prior).toHaveLength(MAX_QUESTIONS_PER_PHASE);
    const { invoker } = scripted([asks('analyzer')]);
    const state = await orch(invoker).executeSequentialPhase(createMockWorkflowState({ humanRequests: prior } as Partial<WorkflowState>), 'analyzer', 'analyzer', {});
    expect(state.status).toBe('failed');
    expect(state.phases[0].error).toContain('Asked more than 3 questions');
    expect(state.humanRequests).toHaveLength(3);
  });

  it('in a parallel stage only the asking agent waits', async () => {
    const invoker = async (_s: any, agent: string) => (agent === 'backend-engineer' ? asks(agent) : good(agent));
    const state = await orch(invoker).executeParallelPhases(createMockWorkflowState(), [
      { phase: 'backend-engineer', agentName: 'backend-engineer', input: {} },
      { phase: 'frontend-engineer', agentName: 'frontend-engineer', input: {} }
    ]);
    expect(state.humanRequests).toHaveLength(1);
    expect(state.humanRequests![0].phase).toBe('backend-engineer');
    expect(state.phases.find(p => p.phase === 'frontend-engineer')!.valid).toBe(true);
    expect(state.status).toBe('paused');
  });
});

describe('a whole workflow with a question', () => {
  it('pauses, refuses to resume unanswered, and continues with the answer in the agent input', async () => {
    let analyzerCalls = 0;
    const seen: Array<Record<string, any>> = [];
    const invoker = async (_s: any, agent: string, input: Record<string, any>) => {
      if (agent === 'analyzer') {
        analyzerCalls++;
        seen.push(input);
        if (!input.humanAnswers) return asks(agent, ask({ format: 'multiple_choice', choices: ['Postgres', 'MySQL'] }));
      }
      return good(agent);
    };
    process.env.FACTORY_IGNORE_WIP = '1';
    const o = orch(invoker);
    const paused = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(paused.status).toBe('paused');
    expect(paused.notes.some(n => n.includes('waiting for a person'))).toBe(true);
    expect(pendingExchange(paused.humanRequests)).toBeDefined();
    expect(paused.phases.map(p => p.phase)).toEqual(['product-manager', 'analyzer']);

    await expect(o.executeWorkflow('Build', 1, {}, paused)).rejects.toThrow(/waiting for an answer to: Which database\?/);

    const checked = validateAnswer(paused.humanRequests![0].request, '2');
    expect(checked).toEqual({ ok: true, value: 'MySQL' });
    const answered = { ...paused, humanRequests: recordAnswer(paused.humanRequests, 'MySQL', 'alice')! };
    const resumed = await o.executeWorkflow('Build', 1, {}, answered, { until: 'analyzer' });

    expect(analyzerCalls).toBe(2);
    expect(seen[1].humanAnswers).toEqual([{ question: 'Which database?', answer: 'MySQL' }]);
    expect(seen[0].humanAnswers).toBeUndefined();
    expect(resumed.phases.filter(p => p.valid).map(p => p.phase)).toEqual(['product-manager', 'analyzer']);
    expect(resumed.notes.some(n => n.includes('Stopped after analyzer'))).toBe(true);
  });
});

describe('the prompt', () => {
  it('tells the agent how to ask, and shows answers already given in the input', () => {
    const p = createAgentPrompt({ instructions: 'You are the analyzer.' }, { brief: 'x', humanAnswers: [{ question: 'Q?', answer: 'A' }] });
    expect(p).toContain('"needs_human"');
    expect(p).toContain('do not guess');
    expect(p).toContain('"humanAnswers":[{"question":"Q?","answer":"A"}]');
  });
});

describe('the factory CLI', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-cli-'));
  const cli = (...args: string[]) => spawnSync('npx', ['ts-node', '.factory/cli.ts', ...args], {
    cwd: path.join(__dirname, '..', '..'), env: { ...process.env, FACTORY_DATA_DIR: dataDir }, encoding: 'utf-8', timeout: 60_000
  });
  const save = (state: WorkflowState) => {
    process.env.FACTORY_DATA_DIR = dataDir;
    saveWorkflowState(state);
  };

  it('refuses an answer in the wrong format, an unknown workflow and one that is not waiting', () => {
    const waiting = createWorkflowState('Build', 1, {});
    const withQuestion: WorkflowState = {
      ...waiting, status: 'paused',
      humanRequests: [newExchange('analyzer', req({ question: 'Deploy now?', format: 'yes_no' }), undefined)]
    };
    save(withQuestion);
    const idle = createWorkflowState('Other', 2, {});
    save(idle);

    const wrong = cli('answer', withQuestion.id, 'maybe');
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('Answer yes or no.');
    expect(wrong.stderr).toContain('Deploy now?');

    const unknown = cli('answer', 'wf-does-not-exist', 'yes');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('not found');

    const notWaiting = cli('answer', idle.id, 'yes');
    expect(notWaiting.status).toBe(1);
    expect(notWaiting.stderr).toContain('not waiting for an answer');

    const retry = cli('retry', withQuestion.id);
    expect(retry.status).toBe(1);
    expect(retry.stderr).toContain('waiting for an answer to: Deploy now?');
  }, 120_000);

  it('shows the pending question in the status output', () => {
    const state: WorkflowState = {
      ...createWorkflowState('Build', 3, {}), status: 'paused',
      humanRequests: [newExchange('analyzer', req({ question: 'Which region?' }), undefined)]
    };
    save(state);
    const out = cli('status', state.id);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('Waiting for a person');
    expect(out.stdout).toContain('Which region?');
    expect(out.stdout).toContain(`factory answer ${state.id}`);
  }, 60_000);
});
