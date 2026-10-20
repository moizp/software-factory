import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ALL_CHECKS, runChecks, tiersFor } from '../verify';
import { githubChecks, REQUIRED_LABELS } from '../verify/checks/github';
import { liveChecks } from '../verify/checks/live';
import { mockChecks } from '../verify/checks/mock';
import { offlineChecks } from '../verify/checks/offline';
import { conformingInvoker } from '../verify/mock-agent';
import { redact } from '../verify/redact';
import { BEGIN, END, counts, exitCode, nextSteps, renderReport } from '../verify/report';
import { writeSampleProject } from '../verify/sample-project';
import { Check, Ctx, Flags, Row } from '../verify/types';

const root = path.join(__dirname, '..', '..');
const flags = (over: Partial<Flags> = {}): Flags => ({ quick: true, live: false, github: false, createLabels: false, brief: 'b', tokenCap: 1000, ...over });
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
const ctxFor = (projectDir: string, over: Partial<Flags> = {}): Ctx => ({ factoryRoot: root, projectDir, flags: flags(over) });
const row = (over: Partial<Row>): Row => ({ id: 'x.y', tier: 'env', title: 'T', ms: 1, status: 'pass', detail: 'ok', ...over });
const byId = (id: string): Check => ALL_CHECKS.find(c => c.id === id)!;

describe('redact', () => {
  it.each([
    ['a GitHub token', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end'],
    ['an API key', 'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['an AWS key', 'AKIAABCDEFGHIJKLMNOP'],
    ['a bearer header', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'],
    ['an assignment', 'STRIPE_TOKEN=abcdef123456'],
    ['JSON', '{"token":"abcdef123456"}']
  ])('removes %s', (_name, text) => {
    const out = redact(text);
    expect(out).toMatch(/\[[a-z-]+\]/);
    expect(out).not.toMatch(/abcdefghijklmnopqrstuvwxyz|abcdef123456|AKIAABCDEFGHIJKLMNOP/);
  });
  it('leaves ordinary text alone', () => {
    expect(redact('Node 24.1.0 on linux; 18 pass, 0 fail')).toBe('Node 24.1.0 on linux; 18 pass, 0 fail');
  });
});

describe('report', () => {
  const meta = { generatedAt: 'now', factoryCommit: 'abc', factoryBranch: 'main', node: '24', os: 'linux', claude: '2', gh: '2', projectDir: '/p', tiers: ['env' as const], flags: '' };
  const rows = [row({ id: 'a', status: 'pass' }), row({ id: 'b', status: 'warn', detail: 'careful', next: 'do this' }), row({ id: 'c', status: 'fail', detail: 'broken', extra: 'line one\nline two', next: 'do that' }), row({ id: 'd', status: 'skip', next: 'do this' })];
  it('counts, and fails the run only on a failure', () => {
    expect(counts(rows)).toEqual({ pass: 1, warn: 1, fail: 1, skip: 1 });
    expect(exitCode(rows)).toBe(1);
    expect(exitCode(rows.filter(r => r.status !== 'fail'))).toBe(0);
  });
  it('renders a table between markers, the failure output and the next steps once each', () => {
    const md = renderReport(meta, rows);
    expect(md.startsWith(BEGIN)).toBe(true);
    expect(md.endsWith(END)).toBe(true);
    expect(md).toContain('| c | FAIL | broken |');
    expect(md).toContain('line two');
    expect(nextSteps(rows)).toEqual(['do this', 'do that']);
    expect(md).toContain('1. do this\n2. do that');
  });
  it('never prints a credential, wherever it came from', () => {
    const md = renderReport(meta, [row({ status: 'fail', detail: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', extra: 'sk-ant-abcdefghijklmnopqrstuvwxyz' })]);
    expect(md).not.toMatch(/ghp_abcdef|sk-ant-abcdef/);
  });
});

describe('runner', () => {
  it('turns a check that throws into a failed row and carries on', async () => {
    const checks: Check[] = [
      { id: 't.boom', tier: 'env', title: 'boom', run: () => { throw new Error('exploded'); } },
      { id: 't.fine', tier: 'env', title: 'fine', run: () => ({ status: 'pass', detail: 'ok' }) }
    ];
    const seen: string[] = [];
    const rows = await runChecks(ctxFor(root), checks, r => seen.push(r.id));
    expect(rows.map(r => r.status)).toEqual(['fail', 'pass']);
    expect(rows[0].detail).toContain('exploded');
    expect(seen).toEqual(['t.boom', 't.fine']);
  });
  it('has unique ids, and leaves the github tier out unless asked', () => {
    const ids = ALL_CHECKS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tiersFor(ctxFor(root))).not.toContain('github');
    expect(tiersFor(ctxFor(root, { github: true }))).toContain('github');
  });
});

describe('project declarations (offline)', () => {
  const run = async (dir: string, ids: string[]) => runChecks(ctxFor(dir), offlineChecks.filter(c => ids.includes(c.id)));
  const ids = ['project.mission', 'project.character', 'project.lookfeel', 'project.language'];

  it('accepts a project built from the skill examples', async () => {
    const dir = tmp();
    writeSampleProject(dir, root);
    const rows = await run(dir, ids);
    expect(rows.map(r => `${r.id}:${r.status}`)).toEqual(ids.map(i => `${i}:pass`));
  });
  it('skips what is not declared, saying which step writes it', async () => {
    const rows = await run(tmp(), ids);
    expect(rows.every(r => r.status === 'skip' && !!r.next)).toBe(true);
  });
  it('fails a declaration that is present but unusable', async () => {
    const dir = tmp();
    writeSampleProject(dir, root);
    fs.writeFileSync(path.join(dir, 'MISSION.md'), '# Mission\n\nTODO\n');
    const [mission] = await run(dir, ['project.mission']);
    expect(mission.status).toBe('fail');
    expect(mission.extra).toBeTruthy();
  });
  it('warns when there is no policy, fails an invalid one, and passes the factory\'s own', async () => {
    const dir = tmp();
    expect((await run(dir, ['project.policy']))[0].status).toBe('warn');
    fs.mkdirSync(path.join(dir, '.factory'));
    fs.writeFileSync(path.join(dir, '.factory', 'policy.json'), '{"version": 2}');
    expect((await run(dir, ['project.policy']))[0].status).toBe('fail');
    expect((await run(root, ['project.policy']))[0].status).toBe('pass');
  });
  it('checks every agent, prompt budget and gate on the factory itself', async () => {
    const rows = await run(root, ['offline.agents', 'offline.prompts', 'offline.gates']);
    expect(rows.map(r => r.status)).toEqual(['pass', 'pass', 'pass']);
  });
});

describe('the model-free pipeline checks', () => {
  it('pass on a project built from the skill examples', async () => {
    const dir = tmp();
    writeSampleProject(dir, root);
    const rows = await runChecks(ctxFor(dir), mockChecks);
    expect(rows.map(r => `${r.id}:${r.status}`)).toEqual(mockChecks.map(c => `${c.id}:pass`));
    expect(rows.find(r => r.status !== 'pass')).toBeUndefined();
  });
  it('leave the process directory and environment as they were', async () => {
    const dir = tmp();
    writeSampleProject(dir, root);
    const before = { cwd: process.cwd(), data: process.env.FACTORY_DATA_DIR, approval: process.env.FACTORY_PLAN_APPROVAL };
    await runChecks(ctxFor(dir), [byId('mock.repair')]);
    expect({ cwd: process.cwd(), data: process.env.FACTORY_DATA_DIR, approval: process.env.FACTORY_PLAN_APPROVAL }).toEqual(before);
  });
  it('fail, with the notes, when a declaration of the project is unusable', async () => {
    const dir = tmp();
    writeSampleProject(dir, root);
    fs.writeFileSync(path.join(dir, 'MISSION.md'), '# Mission\n\nTODO\n');
    const [r] = await runChecks(ctxFor(dir), [byId('mock.project-declarations')]);
    expect(r.status).toBe('fail');
    expect(r.extra).toMatch(/Mission file/);
  });
  it('use an invoker whose replies satisfy every contract', async () => {
    const { invoker } = conformingInvoker();
    const state: any = { mission: undefined };
    const reply = await invoker(state, 'reviewer', {});
    expect(reply.valid).toBe(true);
    expect(reply.review.challenges.length).toBeGreaterThan(0);
  });
});

describe('live and github tiers', () => {
  const withPath = async <T>(dir: string, body: () => Promise<T>): Promise<T> => {
    const saved = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
    try { return await body(); } finally { process.env.PATH = saved; }
  };
  const fakeGh = (dir: string, script: string): string => {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash\necho "$@" >> "${dir}/calls.log"\n${script}\n`, { mode: 0o755 });
    return bin;
  };

  it('live: is a skip that says how to ask, and fails clearly when claude is missing', async () => {
    const [skipped] = await runChecks(ctxFor(root), liveChecks);
    expect(skipped.status).toBe('skip');
    expect(skipped.next).toContain('--live');
    const empty = tmp();
    const saved = process.env.PATH;
    process.env.PATH = empty;
    try {
      const [r] = await runChecks(ctxFor(root, { live: 'requirements' }), liveChecks);
      expect(r.status).toBe('fail');
      expect(r.next).toMatch(/Install Claude Code/);
    } finally { process.env.PATH = saved; }
  });

  it('github: skips every row unless asked', async () => {
    const rows = await runChecks(ctxFor(root), githubChecks);
    expect(rows.every(r => r.status === 'skip')).toBe(true);
  });

  it('github: when gh is not logged in, says so once and skips the rest instead of reporting false results', async () => {
    const dir = tmp();
    const bin = fakeGh(dir, `echo "not logged in" >&2; exit 1`);
    await withPath(bin, async () => {
      const rows = await runChecks(ctxFor(dir, { github: true }), githubChecks);
      expect(rows[0]).toMatchObject({ id: 'github.auth', status: 'fail' });
      expect(rows[0].next).toContain('gh auth login');
      expect(rows.slice(1).every(r => r.status === 'skip')).toBe(true);
    });
  });

  it('github: reports missing labels, creates them on request, and prints secret names but never values', async () => {
    const dir = tmp();
    const bin = fakeGh(dir, `
case "$1 $2" in
  "auth status") exit 0;;
  "repo view") echo '{"nameWithOwner":"o/r","defaultBranchRef":{"name":"main"},"isPrivate":true}';;
  "label list") echo '[{"name":"agent:ready"}]';;
  "label create") exit 0;;
  "secret list") echo '[{"name":"CLAUDE_CODE_OAUTH_TOKEN"}]';;
  "variable list") echo '[{"name":"AGENTS_ENABLED"}]';;
  "workflow list") echo '[]';;
  "api repos/o/r/branches/main/protection") echo 'Not Found' >&2; exit 1;;
  *) echo '[]';;
esac`);
    await withPath(bin, async () => {
      const ids = ['github.auth', 'github.labels', 'github.secrets', 'github.protection'];
      const picked = githubChecks.filter(c => ids.includes(c.id));
      const rows = await runChecks(ctxFor(dir, { github: true }), picked);
      const by = Object.fromEntries(rows.map(r => [r.id, r]));
      expect(by['github.auth'].status).toBe('pass');
      expect(by['github.auth'].detail).toContain('o/r');
      expect(by['github.labels'].status).toBe('fail');
      expect(by['github.labels'].detail).toContain('agent:working');
      expect(by['github.secrets'].status).toBe('pass');
      expect(by['github.secrets'].detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
      expect(by['github.protection'].status).toBe('warn');

      const created = await runChecks(ctxFor(dir, { github: true, createLabels: true }), picked.filter(c => c.id === 'github.labels'));
      expect(created[0].status).toBe('pass');
      const calls = fs.readFileSync(path.join(dir, 'calls.log'), 'utf-8');
      expect(calls.match(/label create/g)?.length).toBe(REQUIRED_LABELS.length - 1);
    });
  });
});

describe('verify command', () => {
  it('lists every check, and writes a report with markers for the checks asked for', () => {
    const dir = tmp();
    const cli = path.join(root, '.factory', 'verify-cli.ts');
    const bin = path.join(root, 'node_modules', '.bin', 'ts-node');
    const list = spawnSync(bin, [cli, '--list'], { encoding: 'utf-8', cwd: root });
    expect(list.status).toBe(0);
    for (const c of ALL_CHECKS) expect(list.stdout).toContain(c.id);

    const out = path.join(dir, 'r.md');
    const run = spawnSync(bin, [cli, '--only', 'offline.agents', '--out', out], { encoding: 'utf-8', cwd: root });
    expect(run.status).toBe(0);
    const md = fs.readFileSync(out, 'utf-8');
    expect(md).toContain(BEGIN);
    expect(md).toContain('| offline.agents | PASS |');
    expect(run.stdout).toContain(END);
  });
});
