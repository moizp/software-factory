import * as fs from 'fs';
import * as path from 'path';
import { Board, evaluateWip, loadBoard, parseBoard, wipLimit } from '../board';
import { GitHubAPI } from '../github-integration';
import { FactoryOrchestrator } from '../orchestrator';
import { stubPayload } from '../contracts';
import { parsePolicy } from '../policy-engine';

const boardFile = path.join(__dirname, '..', 'board.json');
const board: Board = loadBoard(boardFile);

describe('board template (.factory/board.json)', () => {
  it('is a kanban with WIP 1 in progress and 2 in review', () => {
    expect(board.template).toBe('kanban');
    expect(board.statuses.map(s => s.name)).toEqual(['Backlog', 'Ready', 'In progress', 'In review', 'Done']);
    expect(wipLimit(board, 'In progress')).toBe(1);
    expect(wipLimit(board, 'In review')).toBe(2);
    expect(wipLimit(board, 'Backlog')).toBe(Infinity);
  });

  it('defines every label the merge policy and workflows rely on', () => {
    const names = board.labels.map(l => l.name);
    const policy = parsePolicy(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'policy.json'), 'utf-8')));
    for (const label of [...(policy.force_manual_labels ?? []), 'policy:auto', 'policy:manual', 'agent:ready']) {
      expect(names).toContain(label);
    }
  });

  it('has one milestone per phase label', () => {
    for (const phase of ['2', '3', '4']) {
      expect(board.milestones.some(m => m.startsWith(`Phase ${phase}`))).toBe(true);
      expect(board.labels.some(l => l.name === `phase:${phase}`)).toBe(true);
    }
  });

  it.each([
    ['not an object', null],
    ['bad version', { ...board, version: 2 }],
    ['no statuses', { ...board, statuses: [] }],
    ['duplicate status', { ...board, statuses: [...board.statuses, { name: 'Done' }] }],
    ['wip of zero', { ...board, statuses: board.statuses.map(s => (s.name === 'In review' ? { ...s, wip: 0 } : s)) }],
    ['missing In progress wip', { ...board, statuses: board.statuses.map(s => (s.name === 'In progress' ? { name: s.name } : s)) }],
    ['bad label color', { ...board, labels: [{ name: 'x', color: 'red' }] }],
    ['duplicate label', { ...board, labels: [board.labels[0], board.labels[0]] }]
  ])('rejects %s', (_name, raw) => {
    expect(() => parseBoard(raw)).toThrow(/Invalid board/);
  });
});

describe('evaluateWip (limits 1 and 2)', () => {
  it.each([
    [{ inProgress: 0, inReview: 0 }, true],
    [{ inProgress: 0, inReview: 1 }, true],
    [{ inProgress: 1, inReview: 0 }, false],
    [{ inProgress: 0, inReview: 2 }, false],
    [{ inProgress: 1, inReview: 2 }, false]
  ])('%j can start: %s', (counts, expected) => {
    expect(evaluateWip(board, counts).canStart).toBe(expected);
  });

  it('explains which column is full', () => {
    const d = evaluateWip(board, { inProgress: 1, inReview: 2 });
    expect(d.reasons.join()).toMatch(/In progress is at its limit \(1\/1\)/);
    expect(d.reasons.join()).toMatch(/In review is at its limit \(2\/2\)/);
  });
});

describe('GitHubAPI.getWipCounts', () => {
  it('counts drafts as In progress and the rest as In review', async () => {
    const api = new GitHubAPI('token');
    (api as any).octokit.openPulls = [{ draft: true }, { draft: false }, { draft: false }, {}];
    expect(await api.getWipCounts()).toEqual({ inProgress: 1, inReview: 3 });
  });
});

describe('Orchestrator WIP guard', () => {
  const env = { ...process.env };
  const invoker = async (_s: any, agentName: string): Promise<any> => ({
    phase: agentName, valid: true, ...stubPayload(agentName)
  });

  const makeOrchestrator = (counts: any, wip: Board | null = board) => {
    const o: any = new FactoryOrchestrator(invoker, false);
    o.githubAPI = { getWipCounts: jest.fn().mockImplementation(async () => {
      if (counts instanceof Error) throw counts;
      return counts;
    }), createPR: jest.fn().mockResolvedValue(1) };
    o.loadWipBoard = () => wip;
    process.env.GITHUB_OWNER = 'o';
    process.env.GITHUB_REPO = 'r';
    return o as FactoryOrchestrator;
  };

  afterEach(() => {
    process.env = { ...env };
  });

  it('refuses to start new work when In progress is full', async () => {
    const o = makeOrchestrator({ inProgress: 1, inReview: 0 });
    await expect(o.executeWorkflow('Brief', undefined, {})).rejects.toThrow(/WIP limit reached.*In progress/);
  });

  it('refuses to start when In review is full, even with nothing in progress', async () => {
    const o = makeOrchestrator({ inProgress: 0, inReview: 2 });
    await expect(o.executeWorkflow('Brief', undefined, {})).rejects.toThrow(/WIP limit reached.*In review/);
  });

  it('starts when under both limits', async () => {
    const o = makeOrchestrator({ inProgress: 0, inReview: 1 });
    const state = await o.executeWorkflow('Brief', undefined, {});
    expect(state.status).toBe('completed');
  });

  it('can be overridden with FACTORY_IGNORE_WIP', async () => {
    const o = makeOrchestrator({ inProgress: 5, inReview: 5 });
    process.env.FACTORY_IGNORE_WIP = '1';
    const state = await o.executeWorkflow('Brief', undefined, {});
    expect(state.status).toBe('completed');
  });

  it('does not count resuming existing work as new work', async () => {
    const full = makeOrchestrator({ inProgress: 1, inReview: 2 });
    const failing: any = new FactoryOrchestrator(
      async (_s: any, agent: string) => (agent === 'analyzer'
        ? { phase: agent, valid: false, error: 'boom' }
        : { phase: agent, valid: true, ...stubPayload(agent) }) as any,
      false
    );
    const failed = await failing.executeWorkflow('Brief', undefined, {});
    expect(failed.status).toBe('failed');
    const resumed = await full.executeWorkflow('Brief', undefined, {}, failed);
    expect(resumed.status).toBe('completed');
  });

  it('does not block when GitHub cannot be read, or the repo has no board', async () => {
    const unreadable = makeOrchestrator(new Error('network'));
    expect((await unreadable.executeWorkflow('Brief', undefined, {})).status).toBe('completed');
    const noBoard = makeOrchestrator({ inProgress: 9, inReview: 9 }, null);
    expect((await noBoard.executeWorkflow('Brief', undefined, {})).status).toBe('completed');
  });
});
