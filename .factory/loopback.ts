/**
 * Build -> gate -> feedback -> rebuild, with a hard iteration cap.
 * Ends as "passed" or "escalated" (a human needs to look); it never loops forever.
 */
export interface GateResult {
  passed: boolean;
  /** What failed, handed back to the builder as feedback */
  feedback: string;
}

export type LoopOutcome =
  | { status: 'passed'; iterations: number; history: GateResult[] }
  | { status: 'escalated'; iterations: number; history: GateResult[]; reason: string };

export async function loopBack(options: {
  attempt: (iteration: number, feedback: string | null) => Promise<void>;
  gate: () => Promise<GateResult>;
  maxIterations: number;
  /** Stop early if the same failure repeats this many times in a row (default 2) */
  maxRepeatedFailures?: number;
}): Promise<LoopOutcome> {
  const { attempt, gate, maxIterations } = options;
  const maxRepeats = options.maxRepeatedFailures ?? 2;
  const history: GateResult[] = [];
  let feedback: string | null = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    await attempt(iteration, feedback);
    const result = await gate();
    history.push(result);
    if (result.passed) {
      return { status: 'passed', iterations: iteration, history };
    }

    const tail = history.slice(-maxRepeats);
    if (tail.length === maxRepeats && tail.every(r => r.feedback === result.feedback)) {
      return { status: 'escalated', iterations: iteration, history, reason: `the same failure repeated ${maxRepeats} times` };
    }
    feedback = result.feedback;
  }

  return { status: 'escalated', iterations: maxIterations, history, reason: `still failing after ${maxIterations} iterations` };
}
