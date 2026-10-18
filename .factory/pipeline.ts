import * as path from 'path';

/**
 * Single source of truth for agent names ("phases") and the stage order.
 * A phase name IS the agent file name in .claude/agents/<name>.md.
 * Everything that enumerates phases (state, cli, recovery, metrics, analytics,
 * orchestrator) must derive from this module.
 */

export interface AgentContract {
  /** Top-level keys an agent must emit when valid=true (its payload). */
  requiredPayload: string[];
}

export const AGENT_CONTRACTS = {
  'product-manager': { requiredPayload: ['product', 'features'] },
  'analyzer': { requiredPayload: ['analysis'] },
  'software-architect': { requiredPayload: ['architecture', 'api_specification', 'implementation_plan'] },
  'backend-engineer': { requiredPayload: ['generated_files'] },
  'frontend-engineer': { requiredPayload: ['generated_files'] },
  'infrastructure-engineer': { requiredPayload: ['generated_files'] },
  'automation-tester': { requiredPayload: ['test_suite'] },
  'e2e-tester': { requiredPayload: ['test_scenarios'] },
  'reviewer': { requiredPayload: ['review'] },
  'customer-support': { requiredPayload: ['documentation'] }
} as const satisfies Record<string, AgentContract>;

export type AgentName = keyof typeof AGENT_CONTRACTS;

export interface Stage {
  id: string;
  mode: 'sequential' | 'parallel';
  agents: AgentName[];
}

export const STAGES: Stage[] = [
  { id: 'requirements', mode: 'sequential', agents: ['product-manager'] },
  { id: 'analysis', mode: 'sequential', agents: ['analyzer'] },
  { id: 'architecture', mode: 'sequential', agents: ['software-architect'] },
  { id: 'build', mode: 'parallel', agents: ['backend-engineer', 'frontend-engineer', 'infrastructure-engineer'] },
  { id: 'test', mode: 'sequential', agents: ['automation-tester'] },
  { id: 'e2e', mode: 'sequential', agents: ['e2e-tester'] },
  { id: 'review', mode: 'sequential', agents: ['reviewer'] },
  { id: 'docs', mode: 'sequential', agents: ['customer-support'] }
];

export const AGENT_NAMES = Object.keys(AGENT_CONTRACTS) as AgentName[];

/** Flat execution order; parallel agents share a stage index. */
export const PHASE_ORDER: AgentName[] = STAGES.flatMap(s => s.agents);

export function isAgentName(name: string): name is AgentName {
  return Object.prototype.hasOwnProperty.call(AGENT_CONTRACTS, name);
}

/** Stage index of a phase (parallel agents share one), or -1 if unknown. */
export function stageIndex(phase: string): number {
  return STAGES.findIndex(s => (s.agents as string[]).includes(phase));
}

export function agentFilePath(name: string): string {
  return path.join(__dirname, '..', '.claude', 'agents', `${name}.md`);
}
