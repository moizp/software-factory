import { evaluateWip } from '../board';
import { checkDeclaration } from '../mission';
import { actionsRatio, buddyRatio } from './ledger';
import { NEEDS_HUMAN, READY, REVIEW, WORKING, FAILED } from './labels';
import { Budget, Lane, Permission, RouteDecision, RouteInput } from './types';

const CAN_START: Permission[] = ['admin', 'maintain', 'write'];
const SHORT_KINDS = ['review', 'gate', 'triage', 'small-fix'];
const LONG_KINDS = ['pipeline', 'refactor'];
/** Operational tasks that plan no product work, so they owe the mission nothing. */
const MISSION_EXEMPT_KINDS = ['review', 'gate', 'triage'];
/** Longest job that belongs on hosted Actions. */
export const SHORT_MAX_MINUTES = 10;

export const concurrencyGroup = (issue: number): string => `agent-issue-${issue}`;

/** The lane a job asks for, before availability and budget are applied. Explicit labels beat inference. */
export function desiredLane(labels: string[], estimateMinutes?: number): { lane: Lane; why: string } {
  const explicit = (['long', 'burst', 'short'] as Lane[]).find(l => labels.includes(`lane:${l}`));
  if (explicit) return { lane: explicit, why: `label lane:${explicit}` };
  const kind = labels.find(l => l.startsWith('task:'))?.slice(5);
  if (kind && LONG_KINDS.includes(kind)) return { lane: 'long', why: `task:${kind}` };
  if (kind && SHORT_KINDS.includes(kind)) return { lane: 'short', why: `task:${kind}` };
  if (estimateMinutes !== undefined) {
    return estimateMinutes <= SHORT_MAX_MINUTES
      ? { lane: 'short', why: `estimate ${estimateMinutes} min` }
      : { lane: 'long', why: `estimate ${estimateMinutes} min` };
  }
  // Unknown work goes where it costs nothing from the hosted pool.
  return { lane: 'long', why: 'no lane, task or estimate: default long (free)' };
}

function oracleUsable(input: RouteInput): boolean {
  const { state, unavailableMinutes } = input.oracle;
  return state === 'online' || unavailableMinutes <= input.budget.oracleGraceMinutes;
}

function buddyUsable(input: RouteInput): boolean {
  const b: Budget = input.budget;
  return b.buddyEnabled && buddyRatio(input.ledger, b) < b.buddySoftRatio;
}

function start(input: RouteInput, lane: Lane, reasons: string[]): RouteDecision {
  return {
    action: 'start',
    lane,
    reasons,
    concurrencyGroup: concurrencyGroup(input.issue.number),
    addLabels: [WORKING, `lane:${lane}`],
    removeLabels: [READY]
  };
}

/**
 * Pure routing decision for one issue. No network, no model. Order: kill switch, who asked, the
 * issue's state, WIP limits, then the lane. Anything uncertain waits or is ignored; it never starts.
 */
export function route(input: RouteInput): RouteDecision {
  if (!input.enabled) return { action: 'ignore', reasons: ['AGENTS_ENABLED is false (kill switch)'] };

  if (!CAN_START.includes(input.sender.permission)) {
    return { action: 'ignore', reasons: [`${input.sender.login} has ${input.sender.permission} access; write access is needed to start agent work`] };
  }

  const labels = input.issue.labels;
  if (!labels.includes(READY)) return { action: 'ignore', reasons: [`issue is not labelled ${READY}`] };
  const blocking = [WORKING, REVIEW, FAILED, NEEDS_HUMAN].filter(l => labels.includes(l));
  if (blocking.length) return { action: 'ignore', reasons: [`issue already has ${blocking.join(', ')}`] };

  // Before any lane or token is spent: the issue must say which behaviour change it serves (or why it is an exception)
  let missionNote: string | undefined;
  const exempt = MISSION_EXEMPT_KINDS.find(k => labels.includes(`task:${k}`));
  if (input.mission && !exempt) {
    const gate = checkDeclaration(input.mission, input.issue.declaration ?? { serves: [], problems: [] });
    if (!gate.ok) return { action: 'wait', reasons: gate.reasons };
    missionNote = gate.note;
  }

  const wip = evaluateWip(input.board, input.wip);
  if (!wip.canStart) return { action: 'wait', reasons: wip.reasons };

  const want = desiredLane(labels, input.issue.estimateMinutes);
  const reasons = [`wants ${want.lane} (${want.why})`];
  if (missionNote) reasons.push(missionNote);
  const ratio = actionsRatio(input.ledger, input.budget);
  const hostedFull = ratio >= 1;
  const hostedSoftFull = ratio >= input.budget.actionsSoftRatio;
  if (input.ledger === null) reasons.push('ledger unreadable: hosted pool treated as used up');

  if (want.lane === 'burst') {
    if (buddyUsable(input)) return start(input, 'burst', [...reasons, 'Buddy has budget']);
    return { action: 'wait', reasons: [...reasons, 'Buddy is disabled or out of budget'] };
  }

  if (want.lane === 'long') {
    if (oracleUsable(input)) return start(input, 'long', [...reasons, `Oracle runner ${input.oracle.state}`]);
    if (buddyUsable(input)) {
      return start(input, 'burst', [...reasons, `Oracle unavailable ${input.oracle.unavailableMinutes} min (over ${input.budget.oracleGraceMinutes}), Buddy has budget`]);
    }
    return { action: 'wait', reasons: [...reasons, `Oracle unavailable ${input.oracle.unavailableMinutes} min and no Buddy budget`] };
  }

  // short
  if (!hostedSoftFull) return start(input, 'short', [...reasons, `hosted pool ${Math.round(ratio * 100)}% used`]);
  if (oracleUsable(input)) {
    return start(input, 'long', [...reasons, `hosted pool ${Math.round(ratio * 100)}% used (soft limit ${Math.round(input.budget.actionsSoftRatio * 100)}%): moved to Oracle`]);
  }
  if (!hostedFull) {
    return start(input, 'short', [...reasons, `hosted pool ${Math.round(ratio * 100)}% used but Oracle is unavailable: staying short`]);
  }
  return { action: 'wait', reasons: [...reasons, 'hosted pool used up and Oracle unavailable'] };
}
