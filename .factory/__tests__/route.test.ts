import * as path from 'path';
import { loadBoard } from '../board';
import {
  DEFAULT_BUDGET, Budget, Ledger, RouteInput, actionsRatio, buddyRatio, canTransition, concurrencyGroup,
  currentState, desiredLane, emptyLedger, heartbeat, isStale, parseLease, parseLedger, recordUsage, renderLease,
  renderLedger, route, sweep, transition, writeLedger
} from '../route';

// The real template: In progress 1, In review 2.
const board = loadBoard(path.join(__dirname, '..', 'board.json'));

const NOW = new Date('2026-10-17T12:00:00Z');
const ledger = (over: Partial<Ledger> = {}): Ledger => ({ ...emptyLedger(NOW), ...over });

function input(over: Partial<RouteInput> = {}): RouteInput {
  return {
    enabled: true,
    sender: { login: 'alice', permission: 'write' },
    issue: { number: 7, labels: ['agent:ready'] },
    oracle: { state: 'online', unavailableMinutes: 0 },
    ledger: ledger(),
    budget: DEFAULT_BUDGET,
    board,
    wip: { inProgress: 0, inReview: 0 },
    now: NOW,
    ...over
  };
}
const withLabels = (...l: string[]) => ({ number: 7, labels: ['agent:ready', ...l] });

describe('desiredLane', () => {
  it('explicit lane label beats everything, long before burst before short', () => {
    expect(desiredLane(['lane:short', 'task:pipeline'], 99).lane).toBe('short');
    expect(desiredLane(['lane:short', 'lane:long']).lane).toBe('long');
    expect(desiredLane(['lane:short', 'lane:burst']).lane).toBe('burst');
  });
  it('task kind decides next', () => {
    for (const k of ['review', 'gate', 'triage', 'small-fix']) expect(desiredLane([`task:${k}`], 99).lane).toBe('short');
    for (const k of ['pipeline', 'refactor']) expect(desiredLane([`task:${k}`], 1).lane).toBe('long');
  });
  it('then the estimate, with the boundary inclusive', () => {
    expect(desiredLane([], 10).lane).toBe('short');
    expect(desiredLane([], 11).lane).toBe('long');
  });
  it('unknown work defaults to the free lane', () => {
    expect(desiredLane([]).lane).toBe('long');
    expect(desiredLane(['task:mystery']).lane).toBe('long');
  });
});

describe('route: gates before lanes', () => {
  it('ignores when the kill switch is off', () => {
    expect(route(input({ enabled: false })).action).toBe('ignore');
  });
  it('ignores senders without write access', () => {
    for (const permission of ['triage', 'read', 'none'] as const) {
      expect(route(input({ sender: { login: 'bob', permission } })).action).toBe('ignore');
    }
    for (const permission of ['write', 'maintain', 'admin'] as const) {
      expect(route(input({ sender: { login: 'bob', permission } })).action).toBe('start');
    }
  });
  it('ignores issues that are not ready or are already in a state', () => {
    expect(route(input({ issue: { number: 7, labels: [] } })).action).toBe('ignore');
    for (const l of ['agent:working', 'agent:review', 'agent:failed', 'needs-human']) {
      expect(route(input({ issue: withLabels(l) })).action).toBe('ignore');
    }
  });
  it('waits when a WIP limit is reached', () => {
    const d1 = route(input({ wip: { inProgress: 1, inReview: 0 } }));
    const d2 = route(input({ wip: { inProgress: 0, inReview: 2 } }));
    expect(d1.action).toBe('wait');
    expect(d2.action).toBe('wait');
    expect(route(input({ wip: { inProgress: 0, inReview: 1 } })).action).toBe('start');
  });
});

describe('route: lanes', () => {
  it('starts a short job on hosted Actions with the claim labels and a per-issue group', () => {
    const d = route(input({ issue: withLabels('task:review') }));
    expect(d).toMatchObject({ action: 'start', lane: 'short', concurrencyGroup: 'agent-issue-7', addLabels: ['agent:working', 'lane:short'], removeLabels: ['agent:ready'] });
    expect(concurrencyGroup(7)).toBe('agent-issue-7');
  });
  it('starts a long job on Oracle, and still queues it for a short outage', () => {
    expect(route(input({ issue: withLabels('task:pipeline') }))).toMatchObject({ action: 'start', lane: 'long' });
    const brief = route(input({ issue: withLabels('task:pipeline'), oracle: { state: 'offline', unavailableMinutes: 15 } }));
    expect(brief).toMatchObject({ action: 'start', lane: 'long' });
  });
  it('sends long work to Buddy only when Oracle is down past the grace period and Buddy is enabled with budget', () => {
    const down = { state: 'offline' as const, unavailableMinutes: 16 };
    const buddy: Budget = { ...DEFAULT_BUDGET, buddyEnabled: true };
    expect(route(input({ issue: withLabels('task:pipeline'), oracle: down, budget: buddy }))).toMatchObject({ action: 'start', lane: 'burst' });
    expect(route(input({ issue: withLabels('task:pipeline'), oracle: down })).action).toBe('wait');
    const spent = ledger({ buddyGbMinutes: 280 });
    expect(route(input({ issue: withLabels('task:pipeline'), oracle: down, budget: buddy, ledger: spent })).action).toBe('wait');
  });
  it('treats a busy runner like an offline one once past the grace period', () => {
    const buddy: Budget = { ...DEFAULT_BUDGET, buddyEnabled: true };
    const d = route(input({ issue: withLabels('lane:long'), oracle: { state: 'busy', unavailableMinutes: 30 }, budget: buddy }));
    expect(d).toMatchObject({ lane: 'burst' });
  });
  it('honours an explicit burst request only with Buddy budget', () => {
    expect(route(input({ issue: withLabels('lane:burst') })).action).toBe('wait');
    const buddy: Budget = { ...DEFAULT_BUDGET, buddyEnabled: true };
    expect(route(input({ issue: withLabels('lane:burst'), budget: buddy }))).toMatchObject({ lane: 'burst' });
  });
  it('moves short jobs to Oracle at the soft limit, keeps them short if Oracle is down, waits when the pool is gone', () => {
    const soft = ledger({ actionsMinutes: 1600 });
    expect(route(input({ issue: withLabels('task:review'), ledger: soft }))).toMatchObject({ lane: 'long' });
    const down = { state: 'offline' as const, unavailableMinutes: 60 };
    expect(route(input({ issue: withLabels('task:review'), ledger: soft, oracle: down }))).toMatchObject({ lane: 'short' });
    const gone = ledger({ actionsMinutes: 2000 });
    expect(route(input({ issue: withLabels('task:review'), ledger: gone, oracle: down })).action).toBe('wait');
    expect(route(input({ issue: withLabels('task:review'), ledger: gone }))).toMatchObject({ lane: 'long' });
  });
  it('fails closed when the ledger is unreadable: no hosted minutes spent blindly', () => {
    expect(route(input({ issue: withLabels('task:review'), ledger: null }))).toMatchObject({ lane: 'long' });
    const down = { state: 'offline' as const, unavailableMinutes: 60 };
    expect(route(input({ issue: withLabels('task:review'), ledger: null, oracle: down })).action).toBe('wait');
    const buddy: Budget = { ...DEFAULT_BUDGET, buddyEnabled: true };
    expect(route(input({ issue: withLabels('lane:burst'), ledger: null, budget: buddy })).action).toBe('wait');
  });
  it('always explains itself', () => {
    expect(route(input({ issue: withLabels('task:review') })).reasons.length).toBeGreaterThan(1);
  });
});

describe('ledger', () => {
  it('round-trips through an issue body and replaces rather than duplicates', () => {
    const l = ledger({ actionsMinutes: 12, buddyGbMinutes: 8, oracleSeconds: 99 });
    expect(parseLedger(`notes\n${renderLedger(l)}`, NOW)).toEqual(l);
    const body = writeLedger('Pinned ledger', l);
    const again = writeLedger(body, { ...l, actionsMinutes: 13 });
    expect(again.match(/agent-ledger/g)).toHaveLength(1);
    expect(parseLedger(again, NOW)?.actionsMinutes).toBe(13);
  });
  it('starts fresh with no marker or a new month, and fails closed on a damaged marker', () => {
    expect(parseLedger('no marker here', NOW)).toEqual(emptyLedger(NOW));
    const old = renderLedger({ ...ledger({ actionsMinutes: 500 }), month: '2026-09' });
    expect(parseLedger(old, NOW)).toEqual(emptyLedger(NOW));
    expect(parseLedger('<!-- agent-ledger {not json} -->', NOW)).toBeNull();
    expect(parseLedger('<!-- agent-ledger {"month":"2026-10","actionsMinutes":-5,"buddyGbMinutes":0,"oracleSeconds":0} -->', NOW)).toBeNull();
    expect(parseLedger('<!-- agent-ledger {"month":"2026-10"} -->', NOW)).toBeNull();
  });
  it('charges hosted jobs in whole minutes with a one minute floor', () => {
    const b = DEFAULT_BUDGET;
    expect(recordUsage(ledger(), 'route', 20, b, NOW).actionsMinutes).toBe(1);
    expect(recordUsage(ledger(), 'short', 61, b, NOW).actionsMinutes).toBe(2);
    expect(recordUsage(ledger(), 'short', 0, b, NOW).actionsMinutes).toBe(1);
    expect(recordUsage(ledger(), 'short', -5, b, NOW).actionsMinutes).toBe(1);
  });
  it('charges Buddy in GB-minutes and Oracle in seconds only', () => {
    const b: Budget = { ...DEFAULT_BUDGET, buddyRunnerGb: 2 };
    const burst = recordUsage(ledger(), 'burst', 150, b, NOW);
    expect(burst.buddyGbMinutes).toBe(6);
    expect(burst.actionsMinutes).toBe(0);
    const long = recordUsage(ledger(), 'long', 3600, b, NOW);
    expect(long).toMatchObject({ oracleSeconds: 3600, actionsMinutes: 0, buddyGbMinutes: 0 });
  });
  it('starts a new month when charged across a month boundary', () => {
    const old = { ...ledger({ actionsMinutes: 900 }), month: '2026-09' };
    expect(recordUsage(old, 'short', 60, DEFAULT_BUDGET, NOW)).toEqual({ ...emptyLedger(NOW), actionsMinutes: 1 });
  });
  it('computes pool ratios, treating a missing ledger as full', () => {
    expect(actionsRatio(ledger({ actionsMinutes: 500 }), DEFAULT_BUDGET)).toBe(0.25);
    expect(buddyRatio(ledger({ buddyGbMinutes: 150 }), DEFAULT_BUDGET)).toBe(0.5);
    expect(actionsRatio(null, DEFAULT_BUDGET)).toBe(1);
    expect(buddyRatio(null, DEFAULT_BUDGET)).toBe(1);
  });
});

describe('lease', () => {
  const lease = { job: 'run-123', lane: 'long' as const, beat: new Date('2026-10-17T11:50:00Z'), restarts: 0 };
  it('round-trips and rejects malformed leases', () => {
    expect(parseLease(`text ${renderLease(lease)} more`)).toEqual(lease);
    expect(parseLease('<!-- agent-lease job=a lane=nowhere beat=2026-10-17T11:50:00Z restarts=0 -->')).toBeNull();
    expect(parseLease('<!-- agent-lease job=a lane=long beat=yesterday restarts=0 -->')).toBeNull();
    expect(parseLease('nothing')).toBeNull();
  });
  it('goes stale after 30 minutes and a heartbeat revives it', () => {
    expect(isStale(lease, NOW)).toBe(false);
    expect(isStale({ ...lease, beat: new Date('2026-10-17T11:29:00Z') }, NOW)).toBe(true);
    expect(isStale({ ...lease, beat: new Date('2026-10-17T11:30:00Z') }, NOW)).toBe(false);
    expect(isStale(heartbeat({ ...lease, beat: new Date('2026-10-17T10:00:00Z') }, NOW), NOW)).toBe(false);
  });
  it('sweep leaves live leases, requeues a dead one once, then escalates', () => {
    const dead = { ...lease, beat: new Date('2026-10-17T10:00:00Z') };
    const actions = sweep([
      { issue: 1, lease },
      { issue: 2, lease: dead },
      { issue: 3, lease: { ...dead, restarts: 1 } },
      { issue: 4, lease: null }
    ], NOW);
    expect(actions.map(a => [a.issue, a.action])).toEqual([[2, 'requeue'], [3, 'escalate'], [4, 'escalate']]);
    expect(actions[0]).toMatchObject({ restarts: 1 });
  });
});

describe('state labels', () => {
  it('follows the documented machine', () => {
    expect(canTransition('agent:ready', 'agent:working')).toBe(true);
    expect(canTransition('agent:working', 'agent:review')).toBe(true);
    expect(canTransition('agent:working', 'agent:ready')).toBe(true);
    expect(canTransition('agent:ready', 'agent:review')).toBe(false);
    expect(canTransition('agent:review', 'agent:ready')).toBe(false);
  });
  it('reads the current state with needs-human winning', () => {
    expect(currentState([])).toBeNull();
    expect(currentState(['type:fix', 'agent:working'])).toBe('agent:working');
    expect(currentState(['agent:ready', 'needs-human'])).toBe('needs-human');
  });
  it('returns the labels to add and remove, and refuses illegal moves', () => {
    expect(transition(['agent:ready', 'type:fix'], 'agent:working')).toEqual({ add: ['agent:working'], remove: ['agent:ready'] });
    expect(transition([], 'agent:ready')).toEqual({ add: ['agent:ready'], remove: [] });
    expect(() => transition([], 'agent:working')).toThrow('illegal');
    expect(() => transition(['agent:review'], 'agent:ready')).toThrow('illegal');
  });
});
