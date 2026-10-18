import { HumanExchange, HumanRequest, renderQuestion } from '../human';

/**
 * Questions from agents and the answers to them, carried by issue comments. Each comment holds one hidden marker with
 * its data encoded, so a person's edits to the visible text cannot change what the machinery reads. Markers are only
 * trusted on comments written by the workflow bot (see `trusted`), because anyone can paste a marker into a comment.
 */

export const BOT_LOGIN = 'github-actions[bot]';

export interface QuestionMarker {
  workflow: string;
  exchange: string;
  /** Actions run whose artifact holds the saved workflow state; empty when none was kept (the Buddy lane). */
  run: string;
  request: HumanRequest;
}

export interface AnswerMarker {
  workflow: string;
  exchange: string;
  run: string;
  question: string;
  /** The answer after normalisation, such as "yes" or the text of the chosen option. */
  value: string;
  by: string;
}

export interface ResumedMarker {
  exchange: string;
}

export interface IssueComment {
  id: number;
  body: string;
  author: string;
}

type Kind = 'question' | 'answer' | 'resumed' | 'requeue';
const MARKER = /<!-- agent-(question|answer|resumed|requeue) ([A-Za-z0-9+/=]+) -->/;

function encode(kind: Kind, data: object): string {
  return `<!-- agent-${kind} ${Buffer.from(JSON.stringify(data), 'utf-8').toString('base64')} -->`;
}

function decode(body: string): { kind: Kind; data: Record<string, unknown> } | null {
  const m = MARKER.exec(body);
  if (!m) return null;
  try {
    const data = JSON.parse(Buffer.from(m[2], 'base64').toString('utf-8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? { kind: m[1] as Kind, data } : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function renderQuestionComment(ex: HumanExchange, workflow: string, run: string): string {
  const marker: QuestionMarker = { workflow, exchange: ex.id, run, request: ex.request };
  return [
    'An agent needs an answer before it can go on.',
    '',
    renderQuestion(ex, workflow),
    '',
    'Reply to this issue with a comment that starts with `/answer`, for example `/answer yes`. Only people with write access can answer.',
    '',
    encode('question', marker)
  ].join('\n');
}

export function renderAnswerComment(marker: AnswerMarker): string {
  return [
    `Answer from @${marker.by} recorded for question \`${marker.exchange}\`: ${marker.value}`,
    '',
    'The issue is back in the queue; the pipeline resumes where it stopped.',
    '',
    encode('answer', marker)
  ].join('\n');
}

export function renderResumedComment(marker: ResumedMarker, text?: string): string {
  return `${text ?? `The answer to question \`${marker.exchange}\` was used; the pipeline ran on from it.`}\n\n${encode('resumed', marker)}`;
}

/** Added to the sweep's comment when it puts a dead job back in the queue: the run whose saved state the next job can use. */
export function renderRequeueMarker(run: string): string {
  return encode('requeue', { run });
}

/** `/answer <text>` at the start of a comment. Everything after the command, across lines, is the answer. */
export function parseAnswerCommand(body: string): string | null {
  const m = /^\s*\/answer(?:[ \t]+|\r?\n|$)([\s\S]*)$/.exec(body);
  return m ? m[1].trim() : null;
}

/** Only the workflow bot's comments can carry a marker the machinery acts on. */
const trusted = (c: IssueComment): boolean => c.author === BOT_LOGIN;

export function parseQuestion(body: string): QuestionMarker | null {
  const d = decode(body);
  if (!d || d.kind !== 'question') return null;
  const workflow = str(d.data.workflow);
  const exchange = str(d.data.exchange);
  const run = str(d.data.run);
  if (workflow === null || exchange === null || run === null || !d.data.request || typeof d.data.request !== 'object') return null;
  const r = d.data.request as Record<string, unknown>;
  if (!str(r.question) || !str(r.format)) return null;
  return { workflow, exchange, run, request: d.data.request as HumanRequest };
}

export function parseAnswer(body: string): AnswerMarker | null {
  const d = decode(body);
  if (!d || d.kind !== 'answer') return null;
  const [workflow, exchange, run, question, value, by] = ['workflow', 'exchange', 'run', 'question', 'value', 'by'].map(k => str(d.data[k]));
  if (workflow === null || exchange === null || run === null || question === null || value === null || by === null) return null;
  return { workflow, exchange, run, question, value, by };
}

/** The newest trusted marker decides: a question is open, an answer is waiting to be used, or neither. */
export type AskState =
  | { kind: 'none' }
  | { kind: 'requeue'; run: string }
  | { kind: 'question'; question: QuestionMarker }
  | { kind: 'answer'; answer: AnswerMarker };

export function askState(comments: IssueComment[]): AskState {
  const ordered = comments.filter(trusted).sort((a, b) => b.id - a.id);
  for (const c of ordered) {
    const d = decode(c.body);
    if (!d) continue;
    if (d.kind === 'resumed') return { kind: 'none' };
    if (d.kind === 'requeue') {
      const run = str(d.data.run);
      if (run !== null && /^\d+$/.test(run)) return { kind: 'requeue', run };
    } else if (d.kind === 'question') {
      const question = parseQuestion(c.body);
      if (question) return { kind: 'question', question };
    } else {
      const answer = parseAnswer(c.body);
      if (answer) return { kind: 'answer', answer };
    }
  }
  return { kind: 'none' };
}

/** The brief for a restart when the saved state is gone: the issue text plus the decisions a person already made. */
export function briefWithAnswer(brief: string, answer: AnswerMarker): string {
  return `${brief}\n\nA person already answered a question from an earlier run:\nQuestion: ${answer.question}\nAnswer: ${answer.value}`;
}
