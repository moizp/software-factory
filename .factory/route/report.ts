import { WorkflowState } from '../state';
import { AgentName, isAgentName } from '../pipeline';
import { pendingExchange } from '../human';
import { Lane, RouteDecision } from './types';

/** Where a routed pipeline run stops unless the issue says otherwise: cheap, and before any code is written. */
export const DEFAULT_UNTIL: AgentName = 'software-architect';

/** `until:<agent>` label on the issue, checked against the registered agents. Anything else falls back. */
export function untilFromLabels(labels: string[]): AgentName {
  const raw = labels.find(l => l.startsWith('until:'))?.slice('until:'.length);
  return raw !== undefined && isAgentName(raw) ? raw : DEFAULT_UNTIL;
}

export function renderWaitComment(reasons: string[]): string {
  return [
    'Agent work is waiting, nothing was started.',
    '',
    ...reasons.map(r => `- ${r}`),
    '',
    'The issue keeps `agent:ready`. Remove and re-apply the label after fixing the cause to try again.'
  ].join('\n');
}

export function renderClaimComment(decision: Extract<RouteDecision, { action: 'start' }>, until: AgentName): string {
  return [
    `Agent work started on the **${decision.lane}** lane, running the pipeline until \`${until}\`.`,
    '',
    ...decision.reasons.map(r => `- ${r}`)
  ].join('\n');
}

export interface ResultInput {
  state: WorkflowState | null;
  lane: Lane;
  seconds: number;
  jobResult: 'success' | 'failure' | 'cancelled';
  runUrl: string;
  until: AgentName;
  /** The handoff file text; shown in a collapsed block when the run failed. */
  handoff?: string | null;
}

/** True when the run stopped because an agent asked a person something. */
export function isWaitingForAnswer(state: WorkflowState | null): boolean {
  return state?.status === 'paused' && pendingExchange(state.humanRequests) !== undefined;
}

/**
 * The label the issue moves to. A run that stopped at `until` is handed to a person with `agent:review`; a run
 * waiting on an answer goes to `needs-human`, which the `/answer` comment turns back into `agent:ready`.
 */
export function outcome(input: Pick<ResultInput, 'state' | 'jobResult'>): { label: 'agent:review' | 'agent:failed' | 'needs-human'; ok: boolean } {
  const s = input.state?.status;
  const ok = input.jobResult === 'success' && (s === 'completed' || s === 'paused');
  if (ok && isWaitingForAnswer(input.state)) return { label: 'needs-human', ok };
  return { label: ok ? 'agent:review' : 'agent:failed', ok };
}

export function renderResultComment(input: ResultInput): string {
  const { state, lane, seconds, jobResult, runUrl, until, handoff } = input;
  const { ok } = outcome(input);
  const head = ok && isWaitingForAnswer(state)
    ? 'Pipeline paused: an agent asked a question (next comment). The issue is `needs-human` until someone answers.'
    : ok
    ? `Pipeline stopped after \`${until}\` (${state?.status}). A person decides what happens next.`
    : `Pipeline did not finish (job ${jobResult}${state ? `, workflow ${state.status}` : ', no workflow state found'}).`;
  const lines = [head, '', `Lane ${lane}, ${Math.round(seconds)} s, [run log](${runUrl}).`];
  if (state) {
    lines.push('', `Workflow \`${state.id}\`, tokens used: ${state.tokensUsed ?? 0}.`, '', '| Phase | Result |', '|---|---|');
    for (const p of state.phases) {
      lines.push(`| ${p.phase} | ${p.valid ? 'valid' : `invalid${p.error ? `: ${p.error.slice(0, 120)}` : ''}`} |`);
    }
  }
  lines.push('', ok && isWaitingForAnswer(state)
    ? 'Answer with `/answer <your answer>` in a comment; the pipeline then resumes by itself.'
    : ok
    ? 'To continue, label the issue `agent:ready` again with a later `until:<agent>` label.'
    : 'Fix the cause, then label the issue `agent:ready` to retry.');
  if (!ok && handoff) lines.push('', '<details><summary>Handoff for the next session</summary>', '', handoff.trim(), '', '</details>');
  return lines.join('\n');
}
