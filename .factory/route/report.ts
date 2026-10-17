import { WorkflowState } from '../state';
import { AgentName, isAgentName } from '../pipeline';
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
}

/** The label the issue moves to. A run that stopped at `until` is handed to a person with `agent:review`. */
export function outcome(input: Pick<ResultInput, 'state' | 'jobResult'>): { label: 'agent:review' | 'agent:failed'; ok: boolean } {
  const s = input.state?.status;
  const ok = input.jobResult === 'success' && (s === 'completed' || s === 'paused');
  return { label: ok ? 'agent:review' : 'agent:failed', ok };
}

export function renderResultComment(input: ResultInput): string {
  const { state, lane, seconds, jobResult, runUrl, until } = input;
  const { ok } = outcome(input);
  const head = ok
    ? `Pipeline stopped after \`${until}\` (${state?.status}). A person decides what happens next.`
    : `Pipeline did not finish (job ${jobResult}${state ? `, workflow ${state.status}` : ', no workflow state found'}).`;
  const lines = [head, '', `Lane ${lane}, ${Math.round(seconds)} s, [run log](${runUrl}).`];
  if (state) {
    lines.push('', `Workflow \`${state.id}\`, tokens used: ${state.tokensUsed ?? 0}.`, '', '| Phase | Result |', '|---|---|');
    for (const p of state.phases) {
      lines.push(`| ${p.phase} | ${p.valid ? 'valid' : `invalid${p.error ? `: ${p.error.slice(0, 120)}` : ''}`} |`);
    }
  }
  lines.push('', ok
    ? 'To continue, label the issue `agent:ready` again with a later `until:<agent>` label.'
    : 'Fix the cause, then label the issue `agent:ready` to retry.');
  return lines.join('\n');
}
