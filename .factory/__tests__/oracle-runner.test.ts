import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const dir = path.join(__dirname, '..', '..', 'templates', 'workspace', 'runner');

interface Stubs {
  service?: boolean;
  claude?: boolean;
  gh?: boolean;
}

/** Fake gh, systemctl and claude on PATH so the scripts run without a VM; gh calls are recorded. */
function sandbox(stubs: Stubs = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-runner-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'gh.log');
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  };
  write('gh', stubs.gh === false ? 'exit 1' : `echo "$@" >> "${log}"`);
  write('systemctl', stubs.service === false ? 'exit 0' : 'echo "actions.runner.o-r.host.service loaded active running"');
  write('claude', stubs.claude === false ? 'exit 1' : 'echo "2.1.292 (Claude Code)"');
  return {
    root,
    ghCalls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : []),
    env: (extra: Record<string, string> = {}) => ({
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      REPO: 'o/r',
      GH_TOKEN: 'token',
      MIN_FREE_DISK_GB: '0',
      ...extra
    })
  };
}

function heartbeat(env: Record<string, string>) {
  return spawnSync('bash', [path.join(dir, 'heartbeat.sh')], { env, encoding: 'utf-8' });
}

describe('heartbeat.sh', () => {
  it('sets ORACLE_LAST_SEEN when the machine is healthy', () => {
    const s = sandbox();
    const r = heartbeat(s.env());
    expect(r.status).toBe(0);
    const calls = s.ghCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^variable set ORACLE_LAST_SEEN --repo o\/r --body \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it.each([
    ['the runner service is not active', { service: false }, {}, 'no active actions.runner service'],
    ['claude does not run', { claude: false }, {}, 'claude CLI not working'],
    ['an API key is set', {}, { ANTHROPIC_API_KEY: 'sk-x' }, 'ANTHROPIC_API_KEY'],
    ['an auth token is set', {}, { ANTHROPIC_AUTH_TOKEN: 'x' }, 'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN'],
    ['the disk is too full', {}, { MIN_FREE_DISK_GB: '999999999' }, 'free disk'],
    ['there is no token', {}, { GH_TOKEN: '' }, 'GH_TOKEN is not set'],
    ['the variable cannot be set', { gh: false }, {}, 'could not set ORACLE_LAST_SEEN']
  ] as Array<[string, Stubs, Record<string, string>, string]>)('withholds the heartbeat when %s', (_n, stubs, extra, message) => {
    const s = sandbox(stubs);
    const r = heartbeat(s.env(extra));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    if (message !== 'could not set ORACLE_LAST_SEEN') expect(s.ghCalls()).toHaveLength(0);
  });

  it('requires REPO', () => {
    const s = sandbox();
    const env = s.env();
    delete (env as Record<string, string | undefined>).REPO;
    expect(heartbeat(env).status).not.toBe(0);
  });
});

describe('install-runner.sh', () => {
  const install = (args: string[], extra: Record<string, string> = {}) => {
    const s = sandbox();
    return spawnSync('bash', [path.join(dir, 'install-runner.sh'), ...args], {
      env: { ...s.env(), ...extra }, encoding: 'utf-8'
    });
  };
  const good = ['--repo', 'o/r', '--version', '2.999.0', '--sha256', 'a'.repeat(64), '--dry-run'];

  it('plans the whole install in a dry run without touching the machine', () => {
    const r = install(good);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('actions-runner-linux-');
    expect(r.stdout).toContain('2.999.0');
    expect(r.stdout).toContain('--labels oracle');
    expect(r.stdout).toContain('https://github.com/o/r');
    expect(r.stdout).toContain('svc.sh install');
    expect(r.stdout).toContain('oracle-heartbeat.timer');
    expect(r.stdout).toContain('REPO=o/r');
    expect(r.stdout).toContain('claude');
  });

  it('refuses bad input', () => {
    expect(install([]).status).toBe(2);
    expect(install(['--repo', 'not a repo']).status).toBe(2);
    expect(install(['--repo', 'o/r; rm -rf /']).status).toBe(2);
    expect(install([...good, '--user', 'Bad User']).status).toBe(2);
    expect(install([...good, '--bogus']).status).toBe(2);
  });

  it('refuses to run with an API key in the environment', () => {
    const r = install(good, { ANTHROPIC_API_KEY: 'sk-x' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('account login');
  });
});

describe('the pieces agree', () => {
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf-8');
  it('install path, unit, timer and router heartbeat window line up', () => {
    expect(read('install-runner.sh')).toContain('/opt/factory/runner/heartbeat.sh');
    expect(read('oracle-heartbeat.service')).toContain('ExecStart=/opt/factory/runner/heartbeat.sh');
    expect(read('install-runner.sh')).toContain('oracle-heartbeat.timer');
    // five minute timer against the router's ten minute online window: one missed beat is tolerated
    expect(read('oracle-heartbeat.timer')).toContain('OnUnitActiveSec=5min');
  });
  it('the runner has the oracle label the workflow asks for', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'agent-job.yml'), 'utf-8');
    expect(wf).toContain('[self-hosted, oracle]');
    expect(read('install-runner.sh')).toContain('--labels oracle');
  });
  it('versions.env has a runner pin slot', () => {
    expect(fs.readFileSync(path.join(dir, '..', 'versions.env'), 'utf-8')).toMatch(/^RUNNER_VERSION=/m);
  });
});
