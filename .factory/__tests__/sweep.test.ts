import * as fs from 'fs';
import * as path from 'path';
import {
  BOT_ACTOR, DEFAULT_BUDGET, LANE_LABELS, LEDGER_WARNING_MARKER, Lease, Ledger, emptyLedger, escalatedLeaseBody, parseLease,
  renderLedgerWarning, renderSweepComment, renderUsage, requeuedLeaseBody, restartsForNextClaim, senderPermission, sweep
} from '../route';

const NOW = new Date('2026-10-18T12:00:00Z');
const stale: Lease = { job: '123', lane: 'long', beat: new Date('2026-10-18T10:00:00Z'), restarts: 0 };

describe('senderPermission', () => {
  it('trusts the bot actor that a sweep re-dispatch runs as, and looks everyone else up', () => {
    const lookup = jest.fn(() => 'read' as const);
    expect(senderPermission(BOT_ACTOR, lookup)).toBe('write');
    expect(lookup).not.toHaveBeenCalled();
    expect(senderPermission('alice', lookup)).toBe('read');
    expect(lookup).toHaveBeenCalledWith('alice');
  });
  it('does not trust look-alike names', () => {
    for (const name of ['github-actions', 'github-actions[bot] ', 'GitHub-Actions[bot]', 'evil[bot]']) {
      expect(senderPermission(name, () => 'none')).toBe('none');
    }
  });
});

describe('restart bookkeeping', () => {
  it('a requeue keeps the count in the lease marker and the next claim picks it up', () => {
    const [action] = sweep([{ issue: 1, lease: stale }], NOW);
    expect(action).toMatchObject({ action: 'requeue', restarts: 1 });
    const body = requeuedLeaseBody(stale, 1);
    expect(parseLease(body)?.restarts).toBe(1);
    expect(restartsForNextClaim(parseLease(body))).toBe(1);
    // the claim after that, once stale again, escalates instead of looping
    const again = parseLease(body)!;
    expect(sweep([{ issue: 1, lease: { ...again, beat: new Date('2026-10-18T10:00:00Z') } }], NOW)[0].action).toBe('escalate');
  });
  it('an escalated or finished lease leaves no marker, so a person starts again from zero', () => {
    const body = escalatedLeaseBody('no heartbeat', NOW);
    expect(parseLease(body)).toBeNull();
    expect(restartsForNextClaim(parseLease(body))).toBe(0);
    expect(restartsForNextClaim(null)).toBe(0);
  });
  it('requeuing does not refresh the beat', () => {
    expect(parseLease(requeuedLeaseBody(stale, 1))?.beat.toISOString()).toBe(stale.beat.toISOString());
  });
});

describe('sweep comments', () => {
  it('say what happened and what to do', () => {
    const [requeue] = sweep([{ issue: 1, lease: stale }], NOW);
    expect(renderSweepComment(requeue)).toContain('back to `agent:ready`');
    expect(renderSweepComment(requeue)).toContain('restart 1');
    const [escalate] = sweep([{ issue: 2, lease: null }], NOW);
    expect(renderSweepComment(escalate)).toContain('A person needs to look');
  });
  it('knows every lane label to clear on requeue', () => {
    expect(LANE_LABELS).toEqual(['lane:short', 'lane:long', 'lane:burst']);
  });
});

describe('usage report and ledger warning', () => {
  const ledger = (over: Partial<Ledger> = {}): Ledger => ({ ...emptyLedger(NOW), ...over });
  it('shows pool shares', () => {
    const md = renderUsage(ledger({ actionsMinutes: 500, buddyGbMinutes: 150, oracleSeconds: 5400 }), { ...DEFAULT_BUDGET, buddyEnabled: true });
    expect(md).toContain('Agent usage, 2026-10');
    expect(md).toContain('| Hosted Actions | 500 of 2000 min | 25% |');
    expect(md).toContain('| Buddy.works | 150 of 300 GB-min | 50% |');
    expect(md).toContain('| Oracle | 1.5 h | not metered |');
  });
  it('shows Buddy as off when disabled', () => {
    expect(renderUsage(ledger(), DEFAULT_BUDGET)).toContain('| Buddy.works | 0 of 300 GB-min | off |');
  });
  it('reports an unreadable ledger as unknown rather than zero', () => {
    const md = renderUsage(null, DEFAULT_BUDGET);
    expect(md).toContain('unreadable');
    expect(md).not.toContain('0 of');
  });
  it('writes a warning with a marker so it is posted once', () => {
    const w = renderLedgerWarning();
    expect(w).toContain(LEDGER_WARNING_MARKER);
    expect(w).toContain('delete the whole');
  });
});

describe('sweep workflow', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'sweep.yml'), 'utf-8');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'route', 'cli.ts'), 'utf-8');
  it('runs daily and on demand, off the hour, with only the permissions it needs', () => {
    expect(wf).toMatch(/cron: '\d+ \d+ \* \* \*'/);
    expect(wf).not.toMatch(/cron: '0 /);
    expect(wf).toContain('workflow_dispatch');
    expect(wf).toContain('actions: write');
    expect(wf).not.toContain('contents: write');
  });
  it('ends cheaply when nothing is in flight and honours the kill switch', () => {
    expect(wf).toContain("steps.busy.outputs.count != '0' || github.event_name == 'workflow_dispatch'");
    expect(wf).toContain("vars.AGENTS_ENABLED != 'false'");
  });
  it('the CLI cancels, re-dispatches only requeues, and never cancels on a Buddy lease', () => {
    expect(cli).toContain("lease.lane !== 'burst'");
    expect(cli).toContain("if (action.action === 'requeue') dispatchRoute(action.issue);");
  });
});
