import { stubPayload } from '../contracts';
import { stubPlan } from '../plan';
import { Usage, WorkflowState } from '../state';

/**
 * A model-free agent that answers every call with a reply that satisfies the contract, including what the project's
 * declarations demand (mission alignment, look and feel, character). It records what each agent was given, so a check
 * can assert that the declarations reached the agents they are meant for.
 */

export interface Scenario {
  /** This agent declines once with a reason (valid: false). */
  declineOnce?: string;
  /** This agent answers once with something that is not a contract-conformant reply, then conforms when re-asked. */
  malformedOnce?: string;
  /** This agent asks a person a question once, then proceeds with the answer. */
  askOnce?: string;
  /** Total tokens reported per call. */
  tokensPerCall?: number;
}

export interface Call {
  agent: string;
  input: Record<string, unknown>;
}

const usage = (total: number): Usage => ({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: total, costUsd: 0, turns: 1 });

export function conformingInvoker(scenario: Scenario = {}) {
  const calls: Call[] = [];
  const done = new Set<string>();
  const once = (key: string): boolean => (done.has(key) ? false : (done.add(key), true));

  const invoker = async (state: WorkflowState, agent: string, input: Record<string, unknown>): Promise<any> => {
    calls.push({ agent, input });
    const base = { phase: agent, valid: true, usage: usage(scenario.tokensPerCall ?? 100) };

    if (scenario.declineOnce === agent && once(`decline:${agent}`)) {
      return { phase: agent, valid: false, error: 'Declined on purpose by the verification run', usage: usage(1) };
    }
    if (scenario.malformedOnce === agent && once(`malformed:${agent}`)) {
      return { phase: agent, valid: true, usage: usage(1) };
    }
    if (scenario.askOnce === agent && !(input.humanAnswers as unknown[] | undefined)?.length) {
      return {
        phase: agent,
        valid: false,
        error: 'Needs a decision from a person',
        needs_human: { intent: 'clarify', question: 'Verification question: which option?', urgency: 'low', format: 'multiple_choice', choices: ['a', 'b'] },
        usage: usage(1)
      };
    }

    const payload: Record<string, unknown> = stubPayload(agent);
    const ids = state.mission?.behaviourChanges.map(c => c.id) ?? [];

    if (agent === 'product-manager' && state.mission) {
      payload.features = { must_have: [{ name: 'Core flow', serves: ids }], nice_to_have: [] };
      payload.mission_alignment = { behaviour_changes_covered: ids, behaviour_changes_not_covered: [], out_of_mission: [] };
    }
    if (agent === 'software-architect') {
      const plan = stubPlan();
      payload.implementation_plan = ids.length ? { ...plan, phases: plan.phases.map(p => ({ ...p, serves: ids })) } : plan;
    }
    if (agent === 'frontend-engineer') {
      if (state.lookfeel) {
        payload.look_and_feel = { style: 'Follows the declared style', materials: 'Uses the declared materials', motion: 'Uses the declared motion', sound: 'Uses the declared sound rules', interaction: 'Uses the declared interaction feel', deviations: [] };
      }
      if (state.character) {
        payload.character_fit = { traits: 'Words and states follow the declared traits', moments: 'Each moment follows the declared behaviour', deviations: [] };
      }
    }
    if (agent === 'reviewer') {
      payload.review = { agent, challenges: ['Looked for failure paths, duplicated logic and hidden state in the verification stub'] };
    }
    return { ...base, ...payload };
  };

  return { invoker, calls, inputsOf: (agent: string) => calls.filter(c => c.agent === agent).map(c => c.input) };
}
