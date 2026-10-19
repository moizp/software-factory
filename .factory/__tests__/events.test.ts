import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stubPayload } from '../contracts';
import {
  appendEvents, applyEvent, describeEvent, diffStates, eventsPath, readEvents, recordState, replay, stateDifferences, WorkflowEvent
} from '../events';
import { newExchange, recordAnswer } from '../human';
import { FactoryOrchestrator } from '../orchestrator';
import { PLAN_INTENT } from '../plan';
import { WorkflowState, createWorkflowState, loadWorkflowState, saveWorkflowState, readSnapshot } from '../state';
import { retryConfig } from './fixtures';

const root = path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
beforeEach(() => { process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(dir, 'case-')); process.env.FACTORY_IGNORE_WIP = '1'; });
afterEach(() => { delete process.env.FACTORY_DATA_DIR; delete process.env.FACTORY_IGNORE_WIP; });

const gate = (phase: string, valid = true, error?: string) => ({ phase, valid, timestamp: '2026-10-19T10:00:00Z', ...(error ? { error } : {}) }) as any;
const start = (over: Partial<WorkflowState> = {}): WorkflowState => ({ ...createWorkflowState('Build', 7, { a: 1 }), id: 'wf-ev', ...over }) as WorkflowState;
const types = (bodies: Array<{ type: string }>) => bodies.map(b => b.type);

describe('diffStates', () => {
  it('a new workflow is one starting event', () => {
    expect(types(diffStates(null, start()))).toEqual(['workflow_started']);
  });
  it('nothing changed means nothing to record', () => {
    expect(diffStates(start(), start())).toEqual([]);
  });
  it('records additions to the end of a list as one event each', () => {
    const a = start();
    const b = { ...a, phases: [gate('analyzer')], artifacts: [{ phase: 'analyzer', type: 't', timestamp: '' }], notes: ['n1', 'n2'] } as WorkflowState;
    expect(types(diffStates(a, b))).toEqual(['phase_recorded', 'artifact_added', 'note_added', 'note_added']);
  });
  it('records a changed status and token count as one state change, leaving out what did not change', () => {
    const a = start();
    const [ev] = diffStates(a, { ...a, status: 'paused', tokensUsed: 50 });
    expect(ev).toEqual({ type: 'state_changed', changes: { status: 'paused', tokensUsed: 50 } });
  });
  it('a question, its answer and a later update are separate events', () => {
    const a = start();
    const ex = newExchange('analyzer', { intent: 'clarify', question: 'Q?', urgency: 'medium', format: 'free_text' }, undefined);
    const asked = { ...a, humanRequests: [ex] };
    expect(types(diffStates(a, asked))).toEqual(['human_requested']);
    const answered = { ...asked, humanRequests: recordAnswer(asked.humanRequests, 'yes', 'alice')! };
    expect(types(diffStates(asked, answered))).toEqual(['human_replied']);
    const consumed = { ...answered, humanRequests: [{ ...answered.humanRequests![0], consumed: true }] };
    expect(types(diffStates(answered, consumed))).toEqual(['exchange_updated']);
  });
  it('a list that lost entries is replaced as a whole, which is what a resume does', () => {
    const a = { ...start(), phases: [gate('analyzer'), gate('software-architect', false, 'bad')] } as WorkflowState;
    const b = { ...a, phases: [gate('analyzer')] } as WorkflowState;
    expect(diffStates(a, b)).toEqual([{ type: 'list_replaced', field: 'phases', value: [gate('analyzer')] }]);
  });
});

describe('replay', () => {
  it('rebuilds the state from the events, whatever changed on the way', () => {
    const states: WorkflowState[] = [start()];
    const push = (over: Partial<WorkflowState>) => states.push({ ...states[states.length - 1], ...over } as WorkflowState);
    push({ phases: [gate('product-manager')], tokensUsed: 10, currentPhase: 'product-manager' as any });
    push({ notes: ['[t] one'], status: 'paused' });
    push({ phases: [gate('product-manager'), gate('analyzer', false, 'bad')] });
    push({ phases: [gate('product-manager')], notes: [] });
    push({ status: 'completed', issueNumber: undefined, tokensUsed: undefined });
    let events: WorkflowEvent[] = [];
    for (let i = 1; i < states.length; i++) events = events.concat(appendEventsMemory(diffStates(states[i - 1], states[i]), events.length));
    const first = { type: 'workflow_started', state: states[0], seq: 1, at: 't' } as WorkflowEvent;
    const rebuilt = replay([first, ...events.map((e, i) => ({ ...e, seq: i + 2 }))])!;
    expect(stateDifferences(rebuilt, states[states.length - 1])).toEqual([]);
  });
  it('is null for an empty log and refuses events before the start', () => {
    expect(replay([])).toBeNull();
    expect(() => applyEvent(null, { type: 'note_added', note: 'x' })).toThrow(/before workflow_started/);
  });
});

function appendEventsMemory(bodies: any[], offset: number): WorkflowEvent[] {
  return bodies.map((b, i) => ({ seq: offset + i + 1, at: 't', ...b }));
}

describe('the log file', () => {
  it('numbers events after the last one and survives a write cut short', () => {
    const s = start();
    expect(recordState(s, null).map(e => e.seq)).toEqual([1]);
    expect(recordState({ ...s, notes: ['a'] }, null).map(e => e.seq)).toEqual([2]);
    fs.appendFileSync(eventsPath(s.id), '{"seq":3,"at":"t","type":"note_ad');
    const read = readEvents(s.id);
    expect(read.events).toHaveLength(2);
    expect(read.unreadable).toBe(1);
    const next = recordState({ ...s, notes: ['a', 'b'] }, null);
    expect(next.map(e => e.seq)).toEqual([3]);
    expect(readEvents(s.id).events.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(replay(readEvents(s.id).events)!.notes).toEqual(['a', 'b']);
  });
  it('starts a log from the snapshot when only the snapshot exists', () => {
    const snapshot = { ...start(), phases: [gate('analyzer')] } as WorkflowState;
    const events = recordState({ ...snapshot, notes: ['later'] }, snapshot);
    expect(types(events)).toEqual(['workflow_started', 'note_added']);
    expect(stateDifferences(replay(readEvents(snapshot.id).events)!, { ...snapshot, notes: ['later'] })).toEqual([]);
  });
  it('writes nothing when nothing changed', () => {
    const s = start();
    recordState(s, null);
    expect(recordState(s, s)).toEqual([]);
    expect(appendEvents(s.id, [])).toEqual([]);
  });
});

describe('saving and loading', () => {
  it('every save lands in the log first, and the snapshot is the replay of the log', () => {
    let s = start();
    saveWorkflowState(s);
    s = { ...s, phases: [gate('analyzer')], tokensUsed: 5 } as WorkflowState;
    saveWorkflowState(s);
    expect(types(readEvents(s.id).events)).toEqual(['workflow_started', 'phase_recorded', 'state_changed']);
    expect(stateDifferences(replay(readEvents(s.id).events)!, readSnapshot(s.id)!)).toEqual([]);
  });
  it('loads from the log when the snapshot is lost or damaged', () => {
    const s = { ...start(), phases: [gate('analyzer')], status: 'paused' } as WorkflowState;
    saveWorkflowState(s);
    const file = path.join(process.env.FACTORY_DATA_DIR!, 'workflows', `${s.id}.json`);
    fs.writeFileSync(file, '{"id": "wf-ev", "phas');
    expect(loadWorkflowState(s.id)!.status).toBe('paused');
    fs.rmSync(file);
    expect(loadWorkflowState(s.id)!.phases).toHaveLength(1);
    expect(loadWorkflowState('wf-none')).toBeNull();
  });
  it('a log failure never stops a run', () => {
    const s = start();
    fs.mkdirSync(path.join(process.env.FACTORY_DATA_DIR!, 'workflows'), { recursive: true });
    fs.mkdirSync(eventsPath(s.id));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => saveWorkflowState(s)).not.toThrow();
    expect(readSnapshot(s.id)!.id).toBe(s.id);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('the log is not mistaken for a state file', () => {
    saveWorkflowState(start());
    const { listWorkflowStates } = require('../state');
    expect(listWorkflowStates().map((x: WorkflowState) => x.id)).toEqual(['wf-ev']);
  });
});

describe('real workflows replay to what was saved', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  const good = (agent: string, extra: Record<string, unknown> = {}) => ({ phase: agent, valid: true, ...stubPayload(agent), ...extra, usage });
  const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);
  const check = (id: string): void => {
    const { events, unreadable } = readEvents(id);
    expect(unreadable).toBe(0);
    expect(stateDifferences(replay(events)!, readSnapshot(id)!)).toEqual([]);
  };

  it('a run that stops early, then runs to the end', async () => {
    const o = orch((async (_s: any, a: string) => good(a)) as any);
    const stopped = await o.executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    check(stopped.id);
    const done = await o.executeWorkflow('Build', 1, {}, stopped);
    check(done.id);
    expect(done.status).toBe('completed');
    expect(types(readEvents(done.id).events)[0]).toBe('workflow_started');
  });

  it('a failure and its retry, where failed phases are dropped', async () => {
    let calls = 0;
    const o = orch((async (_s: any, a: string) => (a === 'analyzer' && calls++ === 0 ? { phase: a, valid: false, error: 'cannot scope', blockers: [{ x: 1 }] } : good(a))) as any);
    const failed = await o.executeWorkflow('Build', 2, {});
    expect(failed.status).toBe('failed');
    check(failed.id);
    const retried = await o.executeWorkflow('Build', 2, {}, failed, { until: 'analyzer' });
    check(retried.id);
    expect(readEvents(retried.id).events.some(e => e.type === 'list_replaced')).toBe(true);
  });

  it('a question, its answer, and the resumed run', async () => {
    const o = orch((async (_s: any, a: string, input: any) => (a === 'analyzer' && !input.humanAnswers
      ? { phase: a, valid: false, needs_human: { question: 'Which DB?' }, usage } : good(a))) as any);
    const paused = await o.executeWorkflow('Build', 3, {}, undefined, { until: 'analyzer' });
    check(paused.id);
    const answered = { ...paused, humanRequests: recordAnswer(paused.humanRequests, 'Postgres', 'alice')! };
    saveWorkflowState(answered);
    const resumed = await o.executeWorkflow('Build', 3, {}, answered, { until: 'analyzer' });
    check(resumed.id);
    const kinds = types(readEvents(resumed.id).events);
    expect(kinds).toEqual(expect.arrayContaining(['human_requested', 'human_replied']));
  });

  it('a plan sent back for changes and approved', async () => {
    process.env.FACTORY_PLAN_APPROVAL = '1';
    try {
      const o = orch((async (_s: any, a: string) => good(a)) as any);
      const first = await o.executeWorkflow('Build', 4, {}, undefined, { until: 'reviewer' });
      expect(first.humanRequests![0].request.intent).toBe(PLAN_INTENT);
      check(first.id);
      const changes = { ...first, humanRequests: recordAnswer(first.humanRequests, 'split it', 'alice')! };
      saveWorkflowState(changes);
      const second = await o.executeWorkflow('Build', 4, {}, changes, { until: 'reviewer' });
      check(second.id);
      expect(readEvents(second.id).events.some(e => e.type === 'exchange_updated')).toBe(true);
    } finally {
      delete process.env.FACTORY_PLAN_APPROVAL;
    }
  });

  it('describes every kind of event on one line', () => {
    const all = readEvents(start().id).events;
    expect(all).toEqual([]);
    const lines = [
      describeEvent({ seq: 1, at: 't', type: 'workflow_started', state: start() }),
      describeEvent({ seq: 2, at: 't', type: 'phase_recorded', gate: gate('analyzer', false, 'bad\nthing') }),
      describeEvent({ seq: 3, at: 't', type: 'note_added', note: '[2026] hello' }),
      describeEvent({ seq: 4, at: 't', type: 'state_changed', changes: { status: 'paused', updatedAt: 'x' } }),
      describeEvent({ seq: 5, at: 't', type: 'list_replaced', field: 'phases', value: [] })
    ];
    expect(lines).toEqual(['workflow started (running)', 'analyzer invalid: bad thing', 'note: hello', 'state: status = "paused"', 'phases replaced (0 entries)']);
  });
});

describe('factory replay', () => {
  const cli = (...args: string[]) => spawnSync('npx', ['ts-node', '.factory/cli.ts', ...args], {
    cwd: root, env: { ...process.env, FACTORY_DATA_DIR: process.env.FACTORY_DATA_DIR }, encoding: 'utf-8', timeout: 60_000
  });

  it('prints the timeline, confirms a match, and can rebuild a damaged snapshot', () => {
    let s = start();
    saveWorkflowState(s);
    s = { ...s, phases: [gate('analyzer')], notes: ['[t] hello'], status: 'paused' } as WorkflowState;
    saveWorkflowState(s);

    const ok = cli('replay', s.id);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('analyzer valid');
    expect(ok.stdout).toContain('The log replays to the saved state');

    const file = path.join(process.env.FACTORY_DATA_DIR!, 'workflows', `${s.id}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...s, status: 'running', phases: [] }));
    const differs = cli('replay', s.id);
    expect(differs.stdout).toContain('differ in: phases, status');
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).status).toBe('running');

    const fixed = cli('replay', s.id, '--write');
    expect(fixed.stdout).toContain('rewritten from the log');
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).status).toBe('paused');
  });

  it('says so when there is no log', () => {
    const r = cli('replay', 'wf-nothing');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No event log');
  });
});
