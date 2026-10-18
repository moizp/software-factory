import { createAgentPrompt } from '../claude-bridge';
import { stubPayload } from '../contracts';
import { FactoryOrchestrator } from '../orchestrator';
import {
  DEFAULT_MAX_REPAIRS, HARD_MAX_REPAIRS, addUsage, classifyFailure, maxRepairs, trimProblem, withRepair
} from '../repair';
import { Usage } from '../state';
import { createMockWorkflowState, retryConfig } from './fixtures';

const usage = (total: number): Usage => ({
  inputTokens: total, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: total, costUsd: 0, turns: 1
});

const good = (agent: string, tokens = 100) => ({ phase: agent, valid: true, ...stubPayload(agent), usage: usage(tokens) });
const malformed = (agent: string, tokens = 100) => ({
  phase: agent, valid: false, error: 'Could not extract valid JSON from response (length: 9)', failure: 'malformed_output' as const, usage: usage(tokens)
});
/** valid: true but the contract's required payload keys are missing */
const breaksContract = (agent: string, tokens = 100) => ({ phase: agent, valid: true, usage: usage(tokens) });
const declines = (agent: string) => ({ phase: agent, valid: false, error: 'The brief is too vague to design from', usage: usage(100) });

/** An invoker that plays back one scripted reply per call and records the inputs it was given. */
function scripted(replies: Array<any | Error>) {
  const inputs: Array<Record<string, any>> = [];
  const invoker = async (_s: any, _agent: string, input: Record<string, unknown>) => {
    inputs.push(input);
    const next = replies[Math.min(inputs.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { invoker, inputs };
}

const run = (invoker: any, agent = 'product-manager', input: Record<string, unknown> = { brief: 'x' }) =>
  new FactoryOrchestrator(invoker, false, undefined, retryConfig)
    .executeSequentialPhase(createMockWorkflowState(), agent as any, agent, input);

let saved: string | undefined;
beforeEach(() => { saved = process.env.FACTORY_MAX_REPAIRS; delete process.env.FACTORY_MAX_REPAIRS; });
afterEach(() => { if (saved === undefined) delete process.env.FACTORY_MAX_REPAIRS; else process.env.FACTORY_MAX_REPAIRS = saved; });

describe('repair helpers', () => {
  it('reads FACTORY_MAX_REPAIRS safely', () => {
    expect(maxRepairs({})).toBe(DEFAULT_MAX_REPAIRS);
    expect(maxRepairs({ FACTORY_MAX_REPAIRS: '' })).toBe(DEFAULT_MAX_REPAIRS);
    expect(maxRepairs({ FACTORY_MAX_REPAIRS: '0' })).toBe(0);
    expect(maxRepairs({ FACTORY_MAX_REPAIRS: '2' })).toBe(2);
    expect(maxRepairs({ FACTORY_MAX_REPAIRS: '50' })).toBe(HARD_MAX_REPAIRS);
    for (const bad of ['-1', '1.5', 'abc']) expect(maxRepairs({ FACTORY_MAX_REPAIRS: bad })).toBe(DEFAULT_MAX_REPAIRS);
  });
  it('trims and flattens long problems', () => {
    expect(trimProblem('a\n  b\t c')).toBe('a b c');
    const long = trimProblem('x'.repeat(5000));
    expect(long.length).toBe(500);
    expect(long.endsWith('...')).toBe(true);
  });
  it('separates mistakes from decisions', () => {
    expect(classifyFailure(good('analyzer'), null).kind).toBe('none');
    expect(classifyFailure(declines('analyzer'), null).kind).toBe('declined');
    expect(classifyFailure(malformed('analyzer'), null)).toMatchObject({ kind: 'repairable' });
    expect(classifyFailure(breaksContract('analyzer'), '(root) must have required property').kind).toBe('repairable');
    expect(classifyFailure(null, null).kind).toBe('none');
    // a plain failure with no marker, such as a CLI that would not start, is not a mistake to re-ask about
    expect(classifyFailure({ valid: false, error: 'Failed to invoke agent via Claude CLI: ENOENT' }, null).kind).toBe('declined');
  });
  it('adds the repair note without changing the input', () => {
    const input = { brief: 'x' };
    const out = withRepair(input, 1, 'bad\n  json');
    expect(out.repair).toEqual({ attempt: 1, problem: 'bad json' });
    expect(input).toEqual({ brief: 'x' });
  });
  it('adds usage across attempts', () => {
    expect(addUsage(undefined, undefined)).toBeUndefined();
    expect(addUsage(usage(5), undefined)?.totalTokens).toBe(5);
    expect(addUsage(undefined, usage(7))?.totalTokens).toBe(7);
    expect(addUsage(usage(5), usage(7))).toMatchObject({ totalTokens: 12, inputTokens: 12, turns: 2 });
  });
});

describe('the prompt', () => {
  const agent = { instructions: 'You are the analyzer.' };
  it('shows a rejection section and keeps the note out of the JSON context', () => {
    const p = createAgentPrompt(agent, { brief: 'x', repair: { attempt: 1, problem: 'missing key analysis' } });
    expect(p).toContain('YOUR PREVIOUS REPLY WAS REJECTED (attempt 1)');
    expect(p).toContain('missing key analysis');
    expect(p).toContain('{"brief":"x"}');
    expect(p).not.toContain('"repair"');
    expect(p.indexOf('REJECTED')).toBeLessThan(p.indexOf('## INSTRUCTIONS'));
  });
  it('is unchanged when there is nothing to repair', () => {
    const p = createAgentPrompt(agent, { brief: 'x' });
    expect(p).not.toContain('REJECTED');
    expect(p).toContain('---\n\n## INSTRUCTIONS');
  });
  it('cuts a huge problem down', () => {
    const p = createAgentPrompt(agent, { repair: { attempt: 1, problem: 'y'.repeat(9000) } });
    expect(p.length).toBeLessThan(1500);
  });
});

describe('re-asking in a sequential phase', () => {
  it('recovers from unreadable output with one re-ask, adding up the tokens', async () => {
    const { invoker, inputs } = scripted([malformed('product-manager', 100), good('product-manager', 150)]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].repair).toBeUndefined();
    expect(inputs[1].repair).toMatchObject({ attempt: 1 });
    expect(inputs[1].repair.problem).toContain('Could not extract valid JSON');
    expect(inputs[1].brief).toBe('x');
    expect(state.phases).toHaveLength(1);
    expect(state.phases[0].valid).toBe(true);
    expect(state.phases[0].usage?.totalTokens).toBe(250);
    expect(state.tokensUsed).toBe(250);
    expect(state.notes.some(n => n.includes('needed 2 attempts'))).toBe(true);
  });

  it('recovers from a contract violation and names the missing keys', async () => {
    const { invoker, inputs } = scripted([breaksContract('product-manager'), good('product-manager')]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(2);
    expect(inputs[1].repair.problem).toContain('Invalid agent response from product-manager');
    expect(state.phases[0].valid).toBe(true);
  });

  it('never re-asks when the agent declines on its own', async () => {
    const { invoker, inputs } = scripted([declines('product-manager'), good('product-manager')]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(1);
    expect(state.phases[0].valid).toBe(false);
    expect(state.phases[0].error).toContain('too vague');
    expect(state.notes.some(n => n.includes('attempts'))).toBe(false);
  });

  it('gives up after the allowed re-asks and says how many tries were made', async () => {
    const { invoker, inputs } = scripted([malformed('product-manager', 100)]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(2);
    expect(state.phases[0].valid).toBe(false);
    expect(state.phases[0].error).toContain('(after 2 attempts)');
    expect(state.tokensUsed).toBe(200);
  });

  it('a contract violation that never clears ends the phase with the contract errors', async () => {
    const { invoker, inputs } = scripted([breaksContract('product-manager')]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(2);
    expect(state.phases[0].valid).toBe(false);
    expect(state.phases[0].error).toContain('(after 2 attempts)');
  });

  it('FACTORY_MAX_REPAIRS=0 turns it off', async () => {
    process.env.FACTORY_MAX_REPAIRS = '0';
    const { invoker, inputs } = scripted([malformed('product-manager'), good('product-manager')]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(1);
    expect(state.phases[0].valid).toBe(false);
    expect(state.phases[0].error).not.toContain('attempts');
  });

  it('a larger setting allows more re-asks and each carries the latest problem, not a stack', async () => {
    process.env.FACTORY_MAX_REPAIRS = '3';
    const { invoker, inputs } = scripted([malformed('product-manager'), breaksContract('product-manager'), malformed('product-manager'), good('product-manager')]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(4);
    expect(inputs.map(i => i.repair?.attempt)).toEqual([undefined, 1, 2, 3]);
    expect(Object.keys(inputs[3]).filter(k => k === 'repair')).toHaveLength(1);
    expect(state.phases[0].valid).toBe(true);
  });

  it('does not re-ask when the call itself fails', async () => {
    const { invoker, inputs } = scripted([new Error('Failed to invoke agent via Claude CLI: ENOENT')]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(1);
    expect(state.phases[0].valid).toBe(false);
    expect(state.phases[0].error).toContain('ENOENT');
  });

  it('a clean first reply costs nothing extra', async () => {
    const { invoker, inputs } = scripted([good('product-manager', 80)]);
    const state = await run(invoker);
    expect(inputs).toHaveLength(1);
    expect(state.tokensUsed).toBe(80);
    expect(state.notes).toHaveLength(0);
  });
});

describe('re-asking in parallel phases', () => {
  it('repairs each agent on its own and leaves the others alone', async () => {
    const calls: Record<string, number> = {};
    const invoker = async (_s: any, agent: string, input: Record<string, any>) => {
      calls[agent] = (calls[agent] ?? 0) + 1;
      if (agent === 'frontend-engineer' && !input.repair) return malformed(agent);
      return good(agent);
    };
    const orchestrator = new FactoryOrchestrator(invoker as any, false, undefined, retryConfig);
    const state = await orchestrator.executeParallelPhases(createMockWorkflowState(), [
      { phase: 'backend-engineer', agentName: 'backend-engineer', input: {} },
      { phase: 'frontend-engineer', agentName: 'frontend-engineer', input: {} },
      { phase: 'infrastructure-engineer', agentName: 'infrastructure-engineer', input: {} }
    ]);
    expect(calls).toEqual({ 'backend-engineer': 1, 'frontend-engineer': 2, 'infrastructure-engineer': 1 });
    expect(state.phases.map(p => p.valid)).toEqual([true, true, true]);
    expect(state.notes.filter(n => n.includes('needed 2 attempts'))).toHaveLength(1);
  });

  it('an agent that stays broken fails alone and a thrown call is still just a failure', async () => {
    const invoker = async (_s: any, agent: string) => {
      if (agent === 'backend-engineer') return malformed(agent);
      if (agent === 'frontend-engineer') throw new Error('boom');
      return good(agent);
    };
    const orchestrator = new FactoryOrchestrator(invoker as any, false, undefined, retryConfig);
    const state = await orchestrator.executeParallelPhases(createMockWorkflowState(), [
      { phase: 'backend-engineer', agentName: 'backend-engineer', input: {} },
      { phase: 'frontend-engineer', agentName: 'frontend-engineer', input: {} },
      { phase: 'infrastructure-engineer', agentName: 'infrastructure-engineer', input: {} }
    ]);
    const byPhase = Object.fromEntries(state.phases.map(p => [p.phase, p]));
    expect(byPhase['backend-engineer'].valid).toBe(false);
    expect(byPhase['backend-engineer'].error).toContain('(after 2 attempts)');
    expect(byPhase['frontend-engineer'].valid).toBe(false);
    expect(byPhase['frontend-engineer'].error).toContain('boom');
    expect(byPhase['infrastructure-engineer'].valid).toBe(true);
  });
});
