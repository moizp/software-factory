import {
  DEFAULT_EFFORT, DEFAULT_MODEL, agentEffort, agentModel, buildCliArgs, parseCliResult
} from '../claude-bridge';
import { FactoryOrchestrator } from '../orchestrator';
import { stubPayload } from '../contracts';

describe('agent run defaults (token efficiency)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to Sonnet 5.5 at medium effort', () => {
    delete process.env.FACTORY_AGENT_MODEL;
    delete process.env.FACTORY_AGENT_EFFORT;
    const args = buildCliArgs();
    expect(DEFAULT_MODEL).toBe('claude-sonnet-5-5');
    expect(DEFAULT_EFFORT).toBe('medium');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
  });

  it('allows overriding model and effort', () => {
    process.env.FACTORY_AGENT_MODEL = 'claude-haiku-4-5-20251001';
    process.env.FACTORY_AGENT_EFFORT = 'low';
    expect(agentModel()).toBe('claude-haiku-4-5-20251001');
    expect(agentEffort()).toBe('low');
  });

  it('falls back to medium on an invalid effort', () => {
    process.env.FACTORY_AGENT_EFFORT = 'turbo';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(agentEffort()).toBe('medium');
  });

  it('extracts measured usage from the CLI JSON', () => {
    const out = JSON.stringify({
      result: '{"ok":true}',
      is_error: false,
      total_cost_usd: 0.01,
      num_turns: 1,
      usage: { input_tokens: 2, output_tokens: 9, cache_read_input_tokens: 1391, cache_creation_input_tokens: 1089 }
    });
    expect(parseCliResult(out)).toEqual({
      text: '{"ok":true}',
      usage: {
        inputTokens: 2, outputTokens: 9, cacheReadTokens: 1391, cacheCreationTokens: 1089,
        totalTokens: 2491, costUsd: 0.01, turns: 1
      }
    });
  });
});

describe('token tracking, budget and --until', () => {
  const usage = (totalTokens: number) => ({
    inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    totalTokens, costUsd: 0, turns: 1
  });
  const invokerWith = (tokens: number, calls: string[] = []) =>
    async (_state: any, agentName: string): Promise<any> => {
      calls.push(agentName);
      return { phase: agentName, valid: true, ...stubPayload(agentName), usage: usage(tokens) };
    };

  afterEach(() => {
    delete process.env.FACTORY_MAX_TOKENS;
  });

  it('records usage per phase and the workflow total', async () => {
    const orchestrator = new FactoryOrchestrator(invokerWith(1000), false);
    const state = await orchestrator.executeWorkflow('Brief', undefined, {});
    expect(state.status).toBe('completed');
    expect(state.phases.every(p => p.usage?.totalTokens === 1000)).toBe(true);
    expect(state.tokensUsed).toBe(state.phases.length * 1000);
  });

  it('pauses before the next stage when the token budget is reached, and resumes with a higher one', async () => {
    process.env.FACTORY_MAX_TOKENS = '2500';
    const calls: string[] = [];
    const orchestrator = new FactoryOrchestrator(invokerWith(1000, calls), false);
    const paused = await orchestrator.executeWorkflow('Brief', undefined, {});

    expect(paused.status).toBe('paused');
    expect(paused.tokensUsed).toBe(3000);
    expect(calls).toEqual(['product-manager', 'analyzer', 'software-architect']);
    expect(paused.notes.join()).toMatch(/Token budget reached/);

    process.env.FACTORY_MAX_TOKENS = '0';
    calls.length = 0;
    const resumed = await orchestrator.executeWorkflow('Brief', undefined, {}, paused);
    expect(resumed.status).toBe('completed');
    expect(resumed.id).toBe(paused.id);
    expect(calls[0]).toBe('backend-engineer');
    expect(resumed.tokensUsed).toBe(3000 + calls.length * 1000);
  });

  it('stops after the requested agent and can be resumed', async () => {
    const calls: string[] = [];
    const orchestrator = new FactoryOrchestrator(invokerWith(10, calls), false);
    const paused = await orchestrator.executeWorkflow('Brief', undefined, {}, undefined, {
      until: 'analyzer'
    });
    expect(paused.status).toBe('paused');
    expect(calls).toEqual(['product-manager', 'analyzer']);

    calls.length = 0;
    const resumed = await orchestrator.executeWorkflow('Brief', undefined, {}, paused);
    expect(resumed.status).toBe('completed');
    expect(calls[0]).toBe('software-architect');
  });

  it('rejects an unknown --until agent before spending anything', async () => {
    const calls: string[] = [];
    const orchestrator = new FactoryOrchestrator(invokerWith(10, calls), false);
    await expect(
      orchestrator.executeWorkflow('Brief', undefined, {}, undefined, { until: 'nope' as any })
    ).rejects.toThrow(/Unknown agent/);
    expect(calls).toEqual([]);
  });
});
