/**
 * Typed requests for a person. When an agent cannot proceed without a decision only a person can make, it returns
 * `valid: false` with a `needs_human` object instead of guessing. The workflow pauses; an answer resumes it.
 * Everything here is pure: parsing a request, checking an answer, and the text shown to the person.
 */

export type Urgency = 'low' | 'medium' | 'high';
export type AnswerFormat = 'free_text' | 'yes_no' | 'multiple_choice';

export interface HumanRequest {
  /** What kind of help this is, such as clarify, approve or choose. Free text, short. */
  intent: string;
  question: string;
  context?: string;
  urgency: Urgency;
  format: AnswerFormat;
  choices?: string[];
}

export interface HumanExchange {
  id: string;
  phase: string;
  request: HumanRequest;
  askedAt: string;
  answer?: { value: string; by?: string; answeredAt: string };
  /** Set once the answer has been acted on (a plan sent back for changes was revised), so it is not acted on twice. */
  consumed?: boolean;
}

/** A phase that keeps asking is stuck, not making progress: after this many questions it fails instead. */
export const MAX_QUESTIONS_PER_PHASE = 3;
const MAX_QUESTION_CHARS = 1000;
const MAX_CONTEXT_CHARS = 2000;
const MAX_CHOICE_CHARS = 200;
const MAX_ANSWER_CHARS = 4000;

const URGENCIES: Urgency[] = ['low', 'medium', 'high'];
const FORMATS: AnswerFormat[] = ['free_text', 'yes_no', 'multiple_choice'];

type Parsed = { ok: true; request: HumanRequest } | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === 'string';

/** Checks what the model sent and fills the defaults. A bad request is reported precisely so the agent can fix it. */
export function parseRequest(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'needs_human must be an object' };
  const r = raw as Record<string, unknown>;

  if (!isString(r.question) || !r.question.trim()) return { ok: false, error: 'needs_human.question must be a non-empty string' };
  if (r.question.length > MAX_QUESTION_CHARS) return { ok: false, error: `needs_human.question is longer than ${MAX_QUESTION_CHARS} characters` };

  const urgency = r.urgency === undefined ? 'medium' : r.urgency;
  if (!URGENCIES.includes(urgency as Urgency)) return { ok: false, error: `needs_human.urgency must be one of ${URGENCIES.join(', ')}` };

  const format = r.format === undefined ? 'free_text' : r.format;
  if (!FORMATS.includes(format as AnswerFormat)) return { ok: false, error: `needs_human.format must be one of ${FORMATS.join(', ')}` };

  if (r.context !== undefined && (!isString(r.context) || r.context.length > MAX_CONTEXT_CHARS)) {
    return { ok: false, error: `needs_human.context must be a string of at most ${MAX_CONTEXT_CHARS} characters` };
  }
  if (r.intent !== undefined && !isString(r.intent)) return { ok: false, error: 'needs_human.intent must be a string' };

  let choices: string[] | undefined;
  if (format === 'multiple_choice') {
    const list = r.choices;
    if (!Array.isArray(list) || list.length < 2 || list.length > 8 || !list.every(c => isString(c) && c.trim() && c.length <= MAX_CHOICE_CHARS)) {
      return { ok: false, error: `needs_human.choices must be 2 to 8 non-empty strings (each at most ${MAX_CHOICE_CHARS} characters) for multiple_choice` };
    }
    choices = (list as string[]).map(c => c.trim());
    if (new Set(choices.map(c => c.toLowerCase())).size !== choices.length) return { ok: false, error: 'needs_human.choices must be different from each other' };
  }

  return {
    ok: true,
    request: {
      intent: (isString(r.intent) && r.intent.trim()) || 'clarify',
      question: r.question.trim(),
      ...(isString(r.context) && r.context.trim() ? { context: r.context.trim() } : {}),
      urgency: urgency as Urgency,
      format: format as AnswerFormat,
      ...(choices ? { choices } : {})
    }
  };
}

type Checked = { ok: true; value: string } | { ok: false; error: string };

const YES = ['yes', 'y', 'approve', 'approved', 'ok', 'true'];
const NO = ['no', 'n', 'reject', 'rejected', 'deny', 'false'];

/** Checks a person's answer against the question's format and returns the normalised value the agent will see. */
export function validateAnswer(request: HumanRequest, text: string): Checked {
  const t = text.trim();
  if (!t) return { ok: false, error: 'The answer is empty.' };
  if (t.length > MAX_ANSWER_CHARS) return { ok: false, error: `The answer is longer than ${MAX_ANSWER_CHARS} characters.` };

  if (request.format === 'yes_no') {
    const w = t.toLowerCase().replace(/[.!]+$/, '');
    if (YES.includes(w)) return { ok: true, value: 'yes' };
    if (NO.includes(w)) return { ok: true, value: 'no' };
    return { ok: false, error: 'Answer yes or no.' };
  }

  if (request.format === 'multiple_choice') {
    const choices = request.choices ?? [];
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (n >= 1 && n <= choices.length) return { ok: true, value: choices[n - 1] };
    }
    const match = choices.find(c => c.toLowerCase() === t.toLowerCase());
    if (match) return { ok: true, value: match };
    return { ok: false, error: `Pick one of the options by number (1 to ${choices.length}) or by its exact text.` };
  }

  return { ok: true, value: t };
}

export function pendingExchange(exchanges: HumanExchange[] | undefined): HumanExchange | undefined {
  return (exchanges ?? []).find(e => !e.answer);
}

export function questionsAsked(exchanges: HumanExchange[] | undefined, phase: string): number {
  return (exchanges ?? []).filter(e => e.phase === phase).length;
}

/** What the agent is told when it is run again: only the decisions already made for its own phase. */
export function answersFor(exchanges: HumanExchange[] | undefined, phase: string): Array<{ question: string; answer: string }> {
  return (exchanges ?? [])
    .filter(e => e.phase === phase && e.answer)
    .map(e => ({ question: e.request.question, answer: e.answer!.value }));
}

export function newExchange(phase: string, request: HumanRequest, existing: HumanExchange[] | undefined, now: Date = new Date()): HumanExchange {
  return { id: `${phase}-${(existing ?? []).filter(e => e.phase === phase).length + 1}`, phase, request, askedAt: now.toISOString() };
}

/** Records an answer on the pending exchange. Returns null when nothing is waiting. */
export function recordAnswer(
  exchanges: HumanExchange[] | undefined,
  value: string,
  by: string | undefined,
  now: Date = new Date()
): HumanExchange[] | null {
  const waiting = pendingExchange(exchanges);
  if (!waiting) return null;
  return (exchanges ?? []).map(e => (e === waiting ? { ...e, answer: { value, ...(by ? { by } : {}), answeredAt: now.toISOString() } } : e));
}

/** The question as a person reads it, on the terminal or in an issue comment. */
export function renderQuestion(ex: HumanExchange, workflowId: string): string {
  const r = ex.request;
  const lines = [`**${r.intent}** (${r.urgency} urgency, asked by ${ex.phase})`, '', r.question];
  if (r.context) lines.push('', r.context);
  if (r.format === 'yes_no') lines.push('', 'Answer yes or no.');
  else if (r.format === 'multiple_choice') lines.push('', ...(r.choices ?? []).map((c, i) => `${i + 1}. ${c}`), '', 'Answer with the number or the exact text of one option.');
  else lines.push('', 'Answer in your own words.');
  lines.push('', `Workflow \`${workflowId}\`, question \`${ex.id}\`.`);
  return lines.join('\n');
}
