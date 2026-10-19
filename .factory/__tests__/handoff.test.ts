import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stubPayload } from '../contracts';
import {
  buildHandoff, handoffBody, handoffPath, nextSteps, parseHandoff, readHandoff, resumeCommand, saveHandoff, stopReason
} from '../handoff';
import { newExchange, recordAnswer } from '../human';
import { lintPr } from '../gate/pr-lint';
import { FactoryOrchestrator } from '../orchestrator';
import { PLAN_INTENT } from '../plan';
import { renderResultComment } from '../route';
import { WorkflowState, createWorkflowState } from '../state';
import { retryConfig } from './fixtures';

const root = path.join(__dirname, '..', '..');
const ctx = { branch: 'feature/x', commit: 'abc1234', now: new Date('2026-10-18T22:00:00Z') };
const gate = (phase: string, valid: boolean, error?: string) => ({ phase, valid, timestamp: '2026-10-18T10:00:00Z', ...(error ? { error } : {}) });
const base = (over: Partial<WorkflowState> = {}): WorkflowState => ({
  ...createWorkflowState('Build a task tracker\n\nWith login.', 7, {}), id: 'wf-1', ...over
} as WorkflowState);
const withNote = (s: WorkflowState, note: string): WorkflowState => ({ ...s, notes: [...s.notes, `[2026-10-18T10:00:00Z] ${note}`] });

describe('stopReason and nextSteps', () => {
  it('a question waiting for an answer', () => {
    const s = base({ status: 'paused', humanRequests: [newExchange('analyzer', { intent: 'choose', question: 'Which DB?', urgency: 'medium', format: 'free_text' }, undefined)] });
    expect(stopReason(s)).toBe('Waiting for a person to answer a question from analyzer.');
    expect(nextSteps(s)[0]).toContain('factory answer wf-1');
    expect(resumeCommand(s)).toBe('factory answer wf-1 "<answer>"');
  });
  it('a plan waiting for approval', () => {
    const s = base({ status: 'paused', humanRequests: [newExchange('software-architect', { intent: PLAN_INTENT, question: 'Approve?', urgency: 'medium', format: 'free_text' }, undefined)] });
    expect(stopReason(s)).toBe('Waiting for a person to approve the implementation plan.');
    expect(nextSteps(s)[0]).toContain('"approve"');
  });
  it('a failure names the phase and the error, and warns against a blind retry', () => {
    const s = base({ status: 'failed', phases: [gate('product-manager', true), gate('analyzer', false, 'bad json\nsecond line')] as any });
    expect(stopReason(s)).toBe('Failed at analyzer: bad json second line.');
    expect(nextSteps(s).join(' ')).toContain('fix its cause');
    expect(resumeCommand(s)).toBe('factory retry wf-1');
  });
  it('the token budget and an --until stop', () => {
    const budget = withNote(base({ status: 'paused', tokensUsed: 600123 }), 'Token budget reached before stage build: 600123/600000. Raise FACTORY_MAX_TOKENS and run: factory retry wf-1');
    expect(stopReason(budget)).toBe('Stopped by the token budget (600123 tokens used).');
    expect(nextSteps(budget)[0]).toContain('FACTORY_MAX_TOKENS');
    const until = withNote(base({ status: 'paused' }), 'Stopped after analyzer (--until). Continue with: factory retry wf-1');
    expect(stopReason(until)).toBe('Stopped on purpose after analyzer (--until).');
  });
  it('a workflow that was running when the job died', () => {
    expect(stopReason(base({ status: 'running', currentPhase: 'backend-engineer' }))).toContain('Interrupted while running backend-engineer');
  });
});

describe('buildHandoff', () => {
  const answered = (): WorkflowState => {
    const ex = newExchange('analyzer', { intent: 'choose', question: 'Which database?', urgency: 'medium', format: 'free_text' }, undefined);
    return base({
      status: 'paused',
      phases: [gate('product-manager', true), gate('analyzer', true)] as any,
      artifacts: [{ phase: 'product-manager', type: 'product-manager-output', timestamp: '' }] as any,
      humanRequests: recordAnswer([ex], 'Postgres', 'alice')!,
      tokensUsed: 1234
    });
  };

  it('has front matter a tool can read', () => {
    const md = buildHandoff(answered(), ctx);
    expect(parseHandoff(md)).toEqual({
      workflow: 'wf-1', issue: '7', status: 'paused', branch: 'feature/x', commit: 'abc1234',
      written_at: '2026-10-18T22:00:00.000Z', resume: 'factory retry wf-1'
    });
  });
  it('shows the task, each phase, the decisions, the artifacts and the way on', () => {
    const md = buildHandoff(answered(), ctx);
    expect(md).toContain('# Handoff: Build a task tracker');
    expect(md).toContain('| product-manager | done |');
    expect(md).toContain('| analyzer | done |');
    expect(md).toContain('| backend-engineer | not started |');
    expect(md).toContain('- Which database? -> Postgres (alice)');
    expect(md).toContain('- product-manager: product-manager-output');
    expect(md).toContain('Tokens used: 1234.');
    expect(md).toContain('1. `factory retry wf-1`');
  });
  it('shows the open question in full', () => {
    const s = base({ status: 'paused', humanRequests: [newExchange('analyzer', { intent: 'choose', question: 'Which DB?', context: 'The brief names none.', urgency: 'high', format: 'multiple_choice', choices: ['Postgres', 'MySQL'] }, undefined)] });
    const md = buildHandoff(s, ctx);
    expect(md).toContain('## Open question');
    expect(md).toContain('1. Postgres');
    expect(md).toContain('| analyzer | waiting for a person |');
  });
  it('keeps the file short and the values on one line', () => {
    const long = base({ issueBrief: 'x'.repeat(5000), notes: Array.from({ length: 30 }, (_, i) => `note ${i}`) });
    const md = buildHandoff({ ...long, status: 'failed', phases: [gate('analyzer', false, 'e|rror '.repeat(80))] as any }, ctx);
    expect(md.length).toBeLessThan(5000);
    expect(md).toContain('note 29');
    expect(md).not.toContain('note 21');
    expect(md.split('| analyzer | failed')[1].split('\n')[0]).not.toContain('|  ');
    const hostile = buildHandoff(base({ id: 'wf-1', issueBrief: '---\nstatus: completed\n---' }), { ...ctx, branch: 'a\nresume: rm -rf' });
    expect(parseHandoff(hostile)!.resume).toBe('factory retry wf-1');
    expect(parseHandoff(hostile)!.status).toBe('running');
  });
  it('names the mission when the project has one', () => {
    const mission = { mission: 'Freelancers get paid on time.', users: ['Freelancers'], notOurMission: [], behaviourChanges: [{ id: 'BC1', name: 'x', who: 'a', from: 'b', to: 'c', signal: 'd' }] };
    expect(buildHandoff({ ...answered(), mission } as WorkflowState, ctx)).toContain('Mission: Freelancers get paid on time. (BC1)');
    expect(buildHandoff(answered(), ctx)).not.toContain('Mission:');
  });
  it('can be shown on an issue without its front matter', () => {
    const body = handoffBody(buildHandoff(answered(), ctx));
    expect(body.startsWith('# Handoff')).toBe(true);
    expect(body).not.toContain('written_at');
  });
});

describe('parseHandoff', () => {
  it('reads a writer handoff, and refuses text without front matter', () => {
    expect(parseHandoff('---\nbranch: feature/a\ncommit: 4f2a9c1\n---\n# Handoff')).toEqual({ branch: 'feature/a', commit: '4f2a9c1' });
    expect(parseHandoff('# Handoff\nno front matter')).toBeNull();
    expect(parseHandoff('---\n---\nx')).toBeNull();
  });
  it('reads the example in the skill', () => {
    const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'handoff.md'), 'utf-8');
    const example = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
    expect(Object.keys(parseHandoff(example)!)).toEqual(['branch', 'commit', 'status', 'written_at', 'resume']);
  });
});

describe('saving', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  beforeEach(() => { process.env.FACTORY_DATA_DIR = dir; });
  afterEach(() => { delete process.env.FACTORY_DATA_DIR; });

  it('writes beside the state, and removes a stale file when the workflow completes', () => {
    const s = base({ id: 'wf-save', status: 'failed' });
    expect(saveHandoff(s, ctx)).toBe(handoffPath('wf-save'));
    expect(readHandoff('wf-save')).toContain('workflow: wf-save');
    expect(saveHandoff({ ...s, status: 'completed' }, ctx)).toBeNull();
    expect(readHandoff('wf-save')).toBeNull();
  });
  it('is not mistaken for a workflow state', () => {
    saveHandoff(base({ id: 'wf-other', status: 'paused' }), ctx);
    const { listWorkflowStates } = require('../state');
    expect(listWorkflowStates().map((s: any) => s.id)).not.toContain('wf-other');
  });
});

describe('the orchestrator', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  const good = (agent: string) => ({ phase: agent, valid: true, ...stubPayload(agent), usage });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-orch-'));
  beforeEach(() => { process.env.FACTORY_DATA_DIR = dir; process.env.FACTORY_IGNORE_WIP = '1'; });
  afterEach(() => { delete process.env.FACTORY_DATA_DIR; delete process.env.FACTORY_IGNORE_WIP; });

  it('leaves a handoff when a workflow stops early or fails, and none when it completes', async () => {
    const o = new FactoryOrchestrator((async (_s: any, agent: string) => good(agent)) as any, false, undefined, retryConfig);
    const stopped = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    const md = readHandoff(stopped.id)!;
    expect(md).toContain('Stopped on purpose after analyzer');
    expect(md).toContain('| analyzer | done |');
    expect(md).toContain('| software-architect | not started |');

    const failing = new FactoryOrchestrator(async (_s: any, agent: string) => (agent === 'analyzer' ? { phase: agent, valid: false, error: 'cannot scope', blockers: [{ x: 1 }] } : good(agent)) as any, false, undefined, retryConfig);
    const failed = await failing.executeWorkflow('Build', 2, {});
    expect(readHandoff(failed.id)).toContain('Failed at analyzer: cannot scope');
  });

  it('removes the handoff when a resumed workflow completes', async () => {
    const o = new FactoryOrchestrator((async (_s: any, agent: string) => good(agent)) as any, false, undefined, retryConfig);
    const stopped = await o.executeWorkflow('Build', 3, {}, undefined, { until: 'analyzer' });
    expect(readHandoff(stopped.id)).not.toBeNull();
    const done = await o.executeWorkflow('Build', 3, {}, stopped);
    expect(done.status).toBe('completed');
    expect(readHandoff(stopped.id)).toBeNull();
  });
});

describe('on the issue', () => {
  const state = base({ status: 'failed', phases: [gate('analyzer', false, 'bad')] as any });
  const input = { state, lane: 'short' as const, seconds: 5, runUrl: 'https://x/run/1', until: 'analyzer' as const };
  it('a failed run carries the handoff in a collapsed block; other results do not', () => {
    const failed = renderResultComment({ ...input, jobResult: 'failure', handoff: '# Handoff: x\n\n## Next steps' });
    expect(failed).toContain('<details><summary>Handoff for the next session</summary>');
    expect(failed).toContain('## Next steps');
    expect(renderResultComment({ ...input, jobResult: 'failure', handoff: null })).not.toContain('<details>');
    const ok = renderResultComment({ ...input, state: { ...state, status: 'paused' } as any, jobResult: 'success', handoff: '# Handoff' });
    expect(ok).not.toContain('<details>');
  });
});

describe('a handoff note must not reach main', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, '.factory', 'policy.json'), 'utf-8'));
  const lint = (files: string[]) => lintPr({ title: 'feat: x', body: '## Testing\n`npm test` passed.', commits: ['feat: x'], files, changedLines: 10, policy });
  it('fails a PR that contains HANDOFF.md at the root', () => {
    expect(lint(['src/a.ts', 'HANDOFF.md']).errors.join()).toContain('handoff-file');
    expect(lint(['src/a.ts']).errors).toEqual([]);
    expect(lint(['docs/HANDOFF.md']).errors).toEqual([]);
  });
});

describe('the writer side', () => {
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8');
  it('/handoff writes the sections the skill defines', () => {
    const skill = read('.claude/skills/handoff.md');
    const template = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
    const sections = [...template.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    expect(sections).toEqual(['Task', 'Status', 'Files that matter', 'Changes so far', 'Decisions', 'Learnings', 'Next steps']);
    const cmd = read('.claude/commands/handoff.md');
    for (const s of sections) expect(cmd).toContain(s);
    expect(cmd).toContain('Do not commit it');
  });
  it('the other skills point at the format', () => {
    expect(read('.claude/skills/task-isolation.md')).toContain('.claude/skills/handoff.md');
    expect(read('.claude/skills/review-loop.md')).toContain('.claude/skills/handoff.md');
  });
  it('/resume-handoff checks the branch and commit before acting', () => {
    const cmd = read('.claude/commands/resume-handoff.md');
    expect(cmd).toContain('merge-base --is-ancestor');
    expect(cmd.indexOf('Compare it with reality')).toBeLessThan(cmd.indexOf('Do the first Next step'));
  });
});
