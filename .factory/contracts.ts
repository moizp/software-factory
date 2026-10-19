import Ajv, { ValidateFunction } from 'ajv';
import envelopeSchema from './contracts/envelope.schema.json';
import { AGENT_CONTRACTS, isAgentName } from './pipeline';
import { conformanceProblems, LookFeel } from './lookfeel';
import { Character, characterConformanceProblems } from './character';
import { alignmentProblems, Declaration, Mission } from './mission';
import { parsePlan, stubPlan } from './plan';

/** Keys that belong to the envelope, not to an agent's payload. */
const ENVELOPE_KEYS = new Set([
  'phase', 'valid', 'error', 'blockers', 'next_inputs', 'output', 'artifacts', 'usage', 'failure', 'needs_human'
]);

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<string, ValidateFunction>();

/** Per-agent JSON Schema: the shared envelope plus that agent's payload keys. */
export function agentSchema(agentName: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    allOf: [envelopeSchema],
    properties: { phase: { const: agentName } }
  };

  if (!isAgentName(agentName)) {
    return base;
  }

  const required = [...AGENT_CONTRACTS[agentName].requiredPayload];
  return {
    ...base,
    if: { properties: { valid: { const: true } }, required: ['valid'] },
    then: { required }
  };
}

function getValidator(agentName: string): ValidateFunction {
  let validate = validators.get(agentName);
  if (!validate) {
    validate = ajv.compile(agentSchema(agentName));
    validators.set(agentName, validate);
  }
  return validate;
}

/** Returns human-readable contract violations; empty when the response conforms. */
export function validateContract(response: unknown, agentName: string, context: ContractContext = {}): string[] {
  const validate = getValidator(agentName);
  if (!validate(response)) {
    return (validate.errors || []).map(e => `${e.instancePath || '(root)'} ${e.message}`);
  }
  return payloadProblems(response, agentName, context);
}

/** What a reply is checked against besides its own shape. */
export interface ContractContext {
  /** The project's mission; when present, planning agents must say how their work serves it. */
  mission?: Mission;
  /** What the brief says about the mission (Serves: and Mission exception: lines). */
  declared?: Declaration;
  /** The project's declared look and feel; when present, the frontend engineer must say how its work follows it. */
  lookfeel?: LookFeel;
  /** The project's declared character; when present, the frontend engineer must say how its work follows it. */
  character?: Character;
}

/** Checks of a payload's content, beyond the presence of its keys. Only for a valid reply. */
function payloadProblems(response: unknown, agentName: string, context: ContractContext): string[] {
  const r = response as Record<string, unknown>;
  if (r.valid !== true) return [];
  if (agentName === 'software-architect') {
    const plan = parsePlan(r.implementation_plan, context.mission ? { mission: context.mission } : {});
    if (!plan.ok) return [plan.error];
  }
  if (agentName === 'product-manager' && context.mission) {
    return alignmentProblems(context.mission, r, { serves: context.declared?.serves, exception: !!context.declared?.exception });
  }
  if (agentName === 'reviewer') return reviewProblems(r);
  if (agentName === 'frontend-engineer') {
    return [
      ...(context.lookfeel ? conformanceProblems(r) : []),
      ...(context.character ? characterConformanceProblems(r) : [])
    ];
  }
  return [];
}

/**
 * The reviewer is a sceptic, not a rubber stamp: it must say what it tried to find wrong. It cannot run code, so it must
 * also say what it could not verify.
 */
function reviewProblems(r: Record<string, unknown>): string[] {
  const review = r.review;
  const challenges = review && typeof review === 'object' ? (review as Record<string, unknown>).challenges : undefined;
  if (!Array.isArray(challenges) || challenges.length === 0 || !challenges.every(c => typeof c === 'string' && c.trim().length >= 10)) {
    return ['review.challenges must list what you tried to find wrong (edge cases, failure paths, needless complexity, duplication, hidden internals), one sentence each; a review that finds nothing says what it looked for'];
  }
  return [];
}

/**
 * Real agents return their payload as top-level keys (product, architecture, ...),
 * not inside output/artifacts. Fold those keys into output + one artifact so
 * downstream phases receive them.
 */
export function normalizeResponse<T extends { valid: boolean; output?: Record<string, unknown>; artifacts?: Array<{ type: string; content: Record<string, unknown> }> }>(
  response: T,
  agentName: string
): T {
  const raw = response as unknown as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!ENVELOPE_KEYS.has(key)) {
      payload[key] = raw[key];
    }
  }

  if (Object.keys(payload).length === 0) {
    return response;
  }

  return {
    ...response,
    output: response.output ?? payload,
    artifacts: response.artifacts ?? (response.valid
      ? [{ type: `${agentName}-output`, content: payload }]
      : undefined)
  };
}

/** Contract-conformant payload stub (every required key present); for mocks and tests. */
export function stubPayload(agentName: string, data: unknown = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (isAgentName(agentName)) {
    for (const key of AGENT_CONTRACTS[agentName].requiredPayload) {
      payload[key] = key === 'implementation_plan' ? stubPlan()
        : key === 'review' ? { agent: agentName, data, challenges: ['Looked for failure paths, duplication and hidden complexity in the stub'] }
        : { agent: agentName, data };
    }
  }
  return payload;
}
