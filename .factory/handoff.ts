import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { pendingExchange, renderQuestion } from './human';
import { renderMissionLine } from './mission';
import { workflowsDir } from './paths';
import { PLAN_INTENT } from './plan';
import { PHASE_ORDER } from './pipeline';
import type { WorkflowState } from './state';

/**
 * A handoff is a short markdown file that lets a fresh session (or a person) pick up a stopped workflow: why it stopped,
 * what is done, what was decided, and the exact command to continue. It is built from the saved state, so it costs no
 * tokens, and it is written whenever a workflow ends without completing. Everything here is pure except `saveHandoff`
 * and `gitContext`.
 */

export interface HandoffContext {
  branch?: string;
  commit?: string;
  now?: Date;
}

const MAX_BRIEF = 1000;
const MAX_NOTES = 8;
const MAX_LINE = 160;

const oneLine = (s: string, max = MAX_LINE): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

/** Why the workflow stopped, in a sentence a person can act on. */
export function stopReason(state: WorkflowState): string {
  const waiting = pendingExchange(state.humanRequests);
  if (waiting) {
    return waiting.request.intent === PLAN_INTENT
      ? 'Waiting for a person to approve the implementation plan.'
      : `Waiting for a person to answer a question from ${waiting.phase}.`;
  }
  if (state.status === 'failed') {
    const failed = [...state.phases].reverse().find(p => !p.valid);
    return `Failed at ${failed?.phase ?? state.currentPhase}${failed?.error ? `: ${oneLine(failed.error)}` : ''}.`;
  }
  if (state.status === 'paused') {
    const note = [...state.notes].reverse().find(n => /Token budget reached|Stopped after/.test(n));
    if (note?.includes('Token budget reached')) return `Stopped by the token budget (${state.tokensUsed ?? 0} tokens used).`;
    const until = note && /Stopped after (\S+)/.exec(note);
    if (until) return `Stopped on purpose after ${until[1]} (--until).`;
    return 'Paused.';
  }
  if (state.status === 'running') return `Interrupted while running ${state.currentPhase}; the job probably died.`;
  return 'Completed.';
}

/** The one command that continues the work. */
export function resumeCommand(state: WorkflowState): string {
  return pendingExchange(state.humanRequests) ? `factory answer ${state.id} "<answer>"` : `factory retry ${state.id}`;
}

/** The commands that continue the work, matched to the reason it stopped. */
export function nextSteps(state: WorkflowState): string[] {
  const waiting = pendingExchange(state.humanRequests);
  if (waiting) {
    return waiting.request.intent === PLAN_INTENT
      ? [`Read the plan below. \`factory answer ${state.id} "approve"\` starts the build; any other answer is taken as changes and the architect revises.`]
      : [`\`factory answer ${state.id} "<answer>"\` (on a GitHub issue: a comment starting with \`/answer\`).`];
  }
  if (state.status === 'failed') {
    return [`Read the error above and fix its cause (a contract problem needs the agent prompt or input fixed, not a retry).`, `\`factory retry ${state.id}\` keeps the finished phases and runs the failed ones again.`];
  }
  if (state.status === 'paused' && state.notes.some(n => n.includes('Token budget reached'))) {
    return [`Raise \`FACTORY_MAX_TOKENS\` (now used: ${state.tokensUsed ?? 0}), then \`factory retry ${state.id}\`.`];
  }
  return [`\`factory retry ${state.id}\` continues from the first phase that is not finished.`];
}

function statusRows(state: WorkflowState): string[] {
  const waiting = pendingExchange(state.humanRequests);
  return PHASE_ORDER.map(agent => {
    const gates = state.phases.filter(p => p.phase === agent);
    const last = gates[gates.length - 1];
    let result: string;
    if (waiting && waiting.phase === agent && (!last || !last.valid)) result = 'waiting for a person';
    else if (!last) result = 'not started';
    else if (last.valid) result = 'done';
    else result = `failed${last.error ? `: ${oneLine(last.error, 100)}` : ''}`;
    return `| ${agent} | ${result.replace(/\|/g, '/')} |`;
  });
}

/** Front matter values stay on one line. */
const fm = (v: string | number | undefined): string => (v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

export function buildHandoff(state: WorkflowState, ctx: HandoffContext = {}): string {
  const now = (ctx.now ?? new Date()).toISOString();
  const waiting = pendingExchange(state.humanRequests);
  const answered = (state.humanRequests ?? []).filter(e => e.answer);
  const artifacts = [...new Set(state.artifacts.map(a => `${a.phase}: ${a.type}`))];
  const notes = state.notes.slice(-MAX_NOTES);

  const lines: string[] = [
    '---',
    `workflow: ${fm(state.id)}`,
    `issue: ${fm(state.issueNumber)}`,
    `status: ${fm(state.status)}`,
    `branch: ${fm(ctx.branch)}`,
    `commit: ${fm(ctx.commit)}`,
    `written_at: ${now}`,
    `resume: ${fm(resumeCommand(state))}`,
    '---',
    '',
    `# Handoff: ${oneLine(state.issueBrief.split('\n')[0] || state.id, 100)}`,
    '',
    '## Why this stopped',
    stopReason(state),
    '',
    '## Task',
    state.issueBrief.length > MAX_BRIEF ? `${state.issueBrief.slice(0, MAX_BRIEF)}...` : state.issueBrief,
    ...(state.mission ? ['', `Mission: ${oneLine(renderMissionLine(state.mission), 300)}`] : []),
    '',
    '## Status',
    '| Phase | Result |',
    '|---|---|',
    ...statusRows(state),
    `Tokens used: ${state.tokensUsed ?? 0}.`
  ];

  if (waiting) lines.push('', '## Open question', renderQuestion(waiting, state.id));
  if (answered.length) {
    lines.push('', '## Decisions made');
    for (const e of answered) lines.push(`- ${oneLine(e.request.question)} -> ${oneLine(e.answer!.value)}${e.answer!.by ? ` (${e.answer!.by})` : ''}`);
  }
  lines.push('', '## Artifacts', artifacts.length ? artifacts.map(a => `- ${a}`).join('\n') : 'None yet.', `The full output of each is in workflows/${state.id}.json; the step-by-step history is in workflows/${state.id}.events.jsonl (factory replay ${state.id}).`);
  lines.push('', '## Learnings', notes.length ? notes.map(n => `- ${oneLine(n)}`).join('\n') : 'None recorded.');
  lines.push('', '## Next steps', ...nextSteps(state).map((s, i) => `${i + 1}. ${s}`), '');
  return lines.join('\n');
}

/** The front matter of a handoff, or null when there is none. Works for the factory's files and for a writer's HANDOFF.md. */
export function parseHandoff(md: string): Record<string, string> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : null;
}

/** The handoff without its front matter, for places where `---` lines would render badly (an issue comment). */
export function handoffBody(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

export const handoffPath = (workflowId: string): string => path.join(workflowsDir(), `${workflowId}.handoff.md`);

export function readHandoff(workflowId: string): string | null {
  const file = handoffPath(workflowId);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

/** Branch and short commit of the checkout, best effort: a missing git or a detached head gives blanks. */
export function gitContext(cwd: string = process.cwd()): HandoffContext {
  const git = (...args: string[]): string | undefined => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; } catch { return undefined; }
  };
  return { branch: git('branch', '--show-current'), commit: git('rev-parse', '--short', 'HEAD') };
}

/** Writes the handoff for a workflow that did not complete, and removes a stale one when it did. Returns the path or null. */
export function saveHandoff(state: WorkflowState, ctx: HandoffContext = gitContext()): string | null {
  const file = handoffPath(state.id);
  if (state.status === 'completed') {
    fs.rmSync(file, { force: true });
    return null;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildHandoff(state, ctx));
  return file;
}
