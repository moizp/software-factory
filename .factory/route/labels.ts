/** Issue labels that form the agent state machine. The labels are the source of truth; the board is a view. */
export const READY = 'agent:ready';
export const WORKING = 'agent:working';
export const REVIEW = 'agent:review';
export const FAILED = 'agent:failed';
export const NEEDS_HUMAN = 'needs-human';

export const STATE_LABELS = [READY, WORKING, REVIEW, FAILED, NEEDS_HUMAN] as const;
export type StateLabel = (typeof STATE_LABELS)[number];

const TRANSITIONS: Record<StateLabel, StateLabel[]> = {
  [READY]: [WORKING, NEEDS_HUMAN],
  [WORKING]: [REVIEW, FAILED, READY, NEEDS_HUMAN],
  [REVIEW]: [NEEDS_HUMAN],
  [FAILED]: [READY, NEEDS_HUMAN],
  [NEEDS_HUMAN]: [READY]
};

export function canTransition(from: StateLabel, to: StateLabel): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The state an issue is in, or null. Anything needing a human wins over other labels. */
export function currentState(labels: string[]): StateLabel | null {
  if (labels.includes(NEEDS_HUMAN)) return NEEDS_HUMAN;
  for (const s of [WORKING, REVIEW, FAILED, READY] as StateLabel[]) {
    if (labels.includes(s)) return s;
  }
  return null;
}

/** Labels to add and remove to move an issue to `to`. Throws on an illegal move so a bug cannot skip a state. */
export function transition(labels: string[], to: StateLabel): { add: string[]; remove: string[] } {
  const from = currentState(labels);
  if (from === null) {
    if (to !== READY) throw new Error(`illegal transition: none -> ${to}`);
    return { add: [READY], remove: [] };
  }
  if (!canTransition(from, to)) throw new Error(`illegal transition: ${from} -> ${to}`);
  return { add: [to], remove: STATE_LABELS.filter(s => s !== to && labels.includes(s)) };
}
