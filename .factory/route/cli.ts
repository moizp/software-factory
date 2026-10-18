#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { loadBoard } from '../board';
import { pendingExchange, validateAnswer } from '../human';
import { workflowsDir } from '../paths';
import { listWorkflowStates } from '../state';
import {
  cancelRun, collaboratorPermission, dispatchRoute, downloadRunArtifact, editComment, editLabels, findBurstIssue, findLeaseComment,
  hasCommentWith, ledgerIssue, listComments, postComment, readIssue, readLeaseComment, setIssueBody, variable, wipCounts, workingIssues
} from './github';
import { askState, briefWithAnswer, parseAnswerCommand, renderAnswerComment, renderQuestionComment, renderResumedComment } from './ask';
import { budgetFromEnv } from './budget';
import { NEEDS_HUMAN, READY, transition, currentState } from './labels';
import { parseLedger, recordUsage, writeLedger } from './ledger';
import { SweepItem, parseLease, renderLease, sweep } from './lease';
import {
  LANE_LABELS, LEDGER_WARNING_MARKER, escalatedLeaseBody, renderLedgerWarning, renderSweepComment, renderUsage,
  requeuedLeaseBody, restartsForNextClaim, senderPermission
} from './sweep';
import { oracleFromHeartbeat } from './oracle';
import { outcome, renderClaimComment, renderResultComment, renderWaitComment, untilFromLabels } from './report';
import { route } from './route';
import { Lane } from './types';

/**
 * Entry points for route.yml and agent-job.yml. Runs on the BASE branch checkout and treats issue text as
 * data: it is read through `gh`, never placed in a shell command.
 *
 *   decide  pick a lane for an issue and, on `start`, claim it (labels plus a lease comment)
 *   beat    refresh the lease comment while a job runs
 *   finish  hand the issue back (review or failed), report, and charge the ledger
 *   lease-id, until, find-burst  print one value for burst.sh on the Buddy lane
 *   answer  an `/answer` comment on a needs-human issue: check who wrote it, record the answer, requeue the issue
 *   resume  run the pipeline from a recorded answer; exits 3 when there is none (run-pipeline.sh then starts normally)
 *   sweep   daily: cancel and requeue (once) or escalate jobs whose lease went stale, report usage, check the ledger
 */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function output(key: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `${key}=${value.replace(/\r?\n/g, ' ')}\n`);
  console.log(`${key}=${value}`);
}

function leaseBody(lane: Lane, job: string, restarts: number, now: Date): string {
  return `Agent lease. Updated by the running job; do not edit.\n\n${renderLease({ job, lane, beat: now, restarts })}`;
}

function charge(charge: Lane | 'route', seconds: number, now: Date): void {
  const issue = ledgerIssue();
  const current = parseLedger(issue.body, now);
  if (current === null) {
    console.warn('ledger marker is damaged: not updating it');
    return;
  }
  setIssueBody(issue.number, writeLedger(issue.body, recordUsage(current, charge, seconds, budgetFromEnv(process.env), now)));
}

function decide(): void {
  const n = parseInt(env('ISSUE_NUMBER'), 10);
  const actor = env('ACTOR');
  const now = new Date();
  const issue = readIssue(n);
  const ledgerInfo = ledgerIssue();

  const decision = route({
    enabled: process.env.AGENTS_ENABLED !== 'false',
    sender: { login: actor, permission: senderPermission(actor, collaboratorPermission) },
    issue: { number: n, labels: issue.labels },
    oracle: oracleFromHeartbeat(variable('ORACLE_LAST_SEEN'), now),
    ledger: parseLedger(ledgerInfo.body, now),
    budget: budgetFromEnv(process.env),
    board: loadBoard(path.join(__dirname, '..', 'board.json')),
    wip: wipCounts(),
    now
  });

  console.log(`decision: ${decision.action}`);
  decision.reasons.forEach(r => console.log(`- ${r}`));
  output('action', decision.action);
  output('author', issue.author);

  if (decision.action === 'wait') {
    postComment(n, renderWaitComment(decision.reasons));
    return;
  }
  if (decision.action !== 'start') return;

  const until = untilFromLabels(issue.labels);
  editLabels(n, decision.addLabels, decision.removeLabels);
  postComment(n, renderClaimComment(decision, until));
  // A requeued issue carries its restart count in the old lease comment.
  const previous = readLeaseComment(n);
  const restarts = restartsForNextClaim(previous ? parseLease(previous.body) : null);
  const leaseId = postComment(n, leaseBody(decision.lane, env('RUN_ID'), restarts, now));
  charge('route', 60, now);

  output('lane', decision.lane);
  output('group', decision.concurrencyGroup);
  output('until', until);
  output('lease_comment', String(leaseId));
}

function beat(): void {
  editComment(parseInt(env('LEASE_COMMENT_ID'), 10), leaseBody(env('LANE') as Lane, env('RUN_ID'), 0, new Date()));
}

function finish(): void {
  const n = parseInt(env('ISSUE_NUMBER'), 10);
  const lane = env('LANE') as Lane;
  const until = untilFromLabels([`until:${env('UNTIL')}`]);
  const now = new Date();
  const seconds = Math.max(0, now.getTime() / 1000 - parseInt(env('START_EPOCH'), 10));
  const jobResult = (process.env.JOB_RESULT as 'success' | 'failure' | 'cancelled') || 'failure';

  const state = listWorkflowStates()
    .filter(s => s.issueNumber === n)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  const { label } = outcome({ state, jobResult });

  const labels = readIssue(n).labels;
  if (currentState(labels) === 'agent:working') {
    const t = transition(labels, label);
    editLabels(n, t.add, t.remove);
  }
  postComment(n, renderResultComment({ state, lane, seconds, jobResult, runUrl: env('RUN_URL'), until }));
  const waiting = state && label === 'needs-human' ? pendingExchange(state.humanRequests) : undefined;
  if (state && waiting) {
    // The Buddy lane keeps no artifact, so its question carries no run and the answer restarts from the brief.
    postComment(n, renderQuestionComment(waiting, state.id, lane === 'burst' ? '' : process.env.RUN_ID ?? ''));
  }
  if (process.env.LEASE_COMMENT_ID) {
    editComment(parseInt(process.env.LEASE_COMMENT_ID, 10), `Agent lease released (${label}) at ${now.toISOString()}.`);
  }
  charge(lane, seconds, now);
}

const WRITERS = ['admin', 'maintain', 'write'];

function answer(): void {
  const n = parseInt(env('ISSUE_NUMBER'), 10);
  const author = env('COMMENT_AUTHOR');
  const text = parseAnswerCommand(env('COMMENT_BODY'));
  if (text === null) return;
  if (!WRITERS.includes(collaboratorPermission(author))) {
    console.log(`ignored: ${author} has no write access`);
    return;
  }

  const issue = readIssue(n);
  const ask = askState(listComments(n));
  if (ask.kind !== 'question' || !issue.labels.includes(NEEDS_HUMAN)) {
    postComment(n, 'Nothing is waiting for an answer on this issue.');
    return;
  }
  const checked = validateAnswer(ask.question.request, text);
  if (!checked.ok) {
    postComment(n, `${checked.error}\n\nThe question is still open. Reply with a new \`/answer\` comment.`);
    return;
  }

  const q = ask.question;
  postComment(n, renderAnswerComment({
    workflow: q.workflow, exchange: q.exchange, run: q.run, question: q.request.question, value: checked.value, by: author
  }));
  const t = transition(issue.labels, READY);
  editLabels(n, t.add, t.remove);
  // Label changes made with GITHUB_TOKEN start no workflow, so the router is started directly.
  dispatchRoute(n);
}

function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) return full;
  }
  return null;
}

/** Brings back the workflow state saved by the run that asked. False when it is gone or unreadable. */
function restoreState(run: string, issue: number, workflow: string): boolean {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-state-'));
  try {
    if (!downloadRunArtifact(run, `workflow-state-issue-${issue}-${run}`, tmp)) return false;
    const file = findFile(tmp, `${workflow}.json`);
    if (!file) return false;
    fs.mkdirSync(workflowsDir(), { recursive: true });
    fs.copyFileSync(file, path.join(workflowsDir(), `${workflow}.json`));
    return true;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function resume(): void {
  const n = parseInt(env('ISSUE_NUMBER'), 10);
  const ask = askState(listComments(n));
  if (ask.kind !== 'answer') process.exit(3);
  const a = ask.answer;

  const issue = readIssue(n);
  const until = untilFromLabels(issue.labels);
  const childEnv = { ...process.env, FACTORY_IGNORE_WIP: '1', FACTORY_ANSWER_BY: a.by };
  const cli = path.join(__dirname, '..', 'cli.ts');

  let args: string[];
  if (restoreState(a.run, n, a.workflow)) {
    console.log(`resuming workflow ${a.workflow} with the answer to ${a.exchange}`);
    args = [cli, 'answer', a.workflow, a.value, '--until', until];
  } else {
    console.log('saved workflow state is not available: starting again with the answer added to the brief');
    args = [cli, 'start', briefWithAnswer(`${issue.title}\n\n${issue.body}`, a), String(n), '--until', until];
  }
  const r = spawnSync('npx', ['ts-node', ...args], { stdio: 'inherit', env: childEnv });
  // Only a finished resume uses the answer up; a failed one can be retried by labelling the issue again.
  if (r.status === 0) postComment(n, renderResumedComment({ exchange: a.exchange }));
  process.exit(r.status ?? 1);
}

function leaseId(): void {
  const id = findLeaseComment(parseInt(env('ISSUE_NUMBER'), 10));
  if (id === null) throw new Error('no lease comment');
  console.log(id);
}

function until(): void {
  console.log(untilFromLabels(readIssue(parseInt(env('ISSUE_NUMBER'), 10)).labels));
}

function findBurst(): void {
  const n = findBurstIssue();
  if (n === null) throw new Error('no claimed burst issue');
  console.log(n);
}

function sweepAll(): void {
  const now = new Date();
  const leases = new Map<number, { id: number; body: string } | null>();
  const items: SweepItem[] = workingIssues().map(issue => {
    const found = readLeaseComment(issue);
    leases.set(issue, found);
    return { issue, lease: found ? parseLease(found.body) : null };
  });

  for (const action of sweep(items, now)) {
    const found = leases.get(action.issue) ?? null;
    const lease = found ? parseLease(found.body) : null;
    // The Buddy lane's lease holds a Buddy execution id, which is not a GitHub run id: never cancel on it.
    if (lease && lease.lane !== 'burst') cancelRun(lease.job);

    const labels = readIssue(action.issue).labels;
    const t = transition(labels, action.action === 'requeue' ? 'agent:ready' : 'needs-human');
    editLabels(action.issue, t.add, [...t.remove, ...LANE_LABELS.filter(l => labels.includes(l))]);
    if (found) {
      editComment(found.id, action.action === 'requeue' && lease
        ? requeuedLeaseBody(lease, action.restarts)
        : escalatedLeaseBody(action.reason, now));
    }
    postComment(action.issue, renderSweepComment(action));
    console.log(`#${action.issue}: ${action.action} (${action.reason})`);
    if (action.action === 'requeue') dispatchRoute(action.issue);
  }

  const ledgerInfo = ledgerIssue();
  const ledger = parseLedger(ledgerInfo.body, now);
  if (ledger === null && !hasCommentWith(ledgerInfo.number, LEDGER_WARNING_MARKER)) {
    postComment(ledgerInfo.number, renderLedgerWarning());
  }
  const usage = renderUsage(ledger, budgetFromEnv(process.env));
  console.log(usage);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${usage}\n`);
  charge('route', 60, now);
}

const commands: Record<string, () => void> = {
  decide, beat, finish, answer, resume, 'lease-id': leaseId, until, 'find-burst': findBurst, sweep: sweepAll
};
const cmd = commands[process.argv[2] ?? ''];
if (!cmd) {
  console.error('Usage: route-cli decide | beat | finish | answer | resume | lease-id | until | find-burst | sweep');
  process.exit(2);
}
try {
  cmd();
} catch (e) {
  console.error(`route ${process.argv[2]} failed: ${(e as Error).message}`);
  process.exit(1);
}
