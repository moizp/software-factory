import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { budgetFromEnv, DEFAULT_BUDGET } from '../route';

const routeDir = path.join(__dirname, '..', 'route');

/** Fake npx, npm, gh and claude on PATH. npx answers the route-cli lookups and records every call and the credentials it saw. */
function sandbox(opts: { pipelineExit?: number; noClaude?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lane-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'calls.log');
  const write = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  write('npx', `
echo "npx $(printf '[%s] ' "$@" | tr '\\n' '~')" >> "${log}"
case "$*" in
  *lease-id*) echo 55 ;;
  *"route/cli.ts until"*) echo analyzer ;;
  *find-burst*) echo 9 ;;
  *"route/cli.ts finish"*) echo "finish START_EPOCH=$START_EPOCH JOB_RESULT=$JOB_RESULT LANE=$LANE RUN_URL=$RUN_URL" >> "${log}" ;;
  *"cli.ts start"*) echo "creds OAUTH=\${CLAUDE_CODE_OAUTH_TOKEN:-} API=\${ANTHROPIC_API_KEY:-} GITHUB_TOKEN=\${GITHUB_TOKEN:-}" >> "${log}"; exit ${opts.pipelineExit ?? 0} ;;
esac
`);
  write('npm', 'exit 0');
  write('gh', `echo "gh $*" >> "${log}"; case "$*" in *"issue view"*) printf 'Title\\n\\nBody text' ;; esac`);
  if (!opts.noClaude) write('claude', 'echo "2.1.292 (Claude Code)"');
  return {
    root,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : []),
    env: (extra: Record<string, string> = {}) => ({
      PATH: `${bin}:${process.env.PATH}`,
      HOME: root,
      HEARTBEAT_SECONDS: '1000',
      ...extra
    })
  };
}

const base = { ISSUE_NUMBER: '7', LANE: 'short', UNTIL: 'analyzer', LEASE_COMMENT_ID: '55', RUN_ID: '1', GH_TOKEN: 'gh-token' };
const runPipeline = (env: Record<string, string>) =>
  spawnSync('bash', [path.join(routeDir, 'run-pipeline.sh')], { env, encoding: 'utf-8' });

describe('budgetFromEnv', () => {
  it('keeps Buddy off unless BUDDY_ENABLED is exactly true', () => {
    expect(budgetFromEnv({}).buddyEnabled).toBe(false);
    expect(budgetFromEnv({ BUDDY_ENABLED: 'TRUE' }).buddyEnabled).toBe(false);
    expect(budgetFromEnv({ BUDDY_ENABLED: '1' }).buddyEnabled).toBe(false);
    expect(budgetFromEnv({ BUDDY_ENABLED: 'true' }).buddyEnabled).toBe(true);
  });
  it('takes a positive runner size and ignores nonsense', () => {
    expect(budgetFromEnv({ BUDDY_RUNNER_GB: '2' }).buddyRunnerGb).toBe(2);
    for (const bad of ['', '0', '-3', 'abc']) expect(budgetFromEnv({ BUDDY_RUNNER_GB: bad }).buddyRunnerGb).toBe(DEFAULT_BUDGET.buddyRunnerGb);
  });
});

describe('run-pipeline.sh', () => {
  it('uses the author account first and never exposes an API key or a GitHub token to the pipeline', () => {
    const s = sandbox();
    const r = runPipeline(s.env({ ...base, AUTHOR_TOKEN: 'author', SHARED_TOKEN: 'shared', API_KEY: 'key', ANTHROPIC_API_KEY: 'leak' }));
    expect(r.status).toBe(0);
    expect(s.calls()).toContain('creds OAUTH=author API= GITHUB_TOKEN=');
  });
  it('falls back to the shared account, then the API key', () => {
    const shared = sandbox();
    runPipeline(shared.env({ ...base, SHARED_TOKEN: 'shared', API_KEY: 'key' }));
    expect(shared.calls()).toContain('creds OAUTH=shared API= GITHUB_TOKEN=');
    const key = sandbox();
    runPipeline(key.env({ ...base, API_KEY: 'key' }));
    expect(key.calls()).toContain('creds OAUTH= API=key GITHUB_TOKEN=');
  });
  it('refuses to start without a credential on hosted and burst lanes', () => {
    for (const lane of ['short', 'burst']) {
      const s = sandbox();
      const r = runPipeline(s.env({ ...base, LANE: lane }));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('No Claude credential');
      expect(s.calls().some(c => c.includes('[start]'))).toBe(false);
    }
  });
  it('lets the Oracle lane use the local login, but not with an API key in the environment', () => {
    const ok = sandbox();
    expect(runPipeline(ok.env({ ...base, LANE: 'long' })).status).toBe(0);
    const bad = sandbox();
    const r = runPipeline(bad.env({ ...base, LANE: 'long', ANTHROPIC_API_KEY: 'sk-x' }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('remove it');
  });
  it('fails when claude is missing', () => {
    const s = sandbox({ noClaude: true });
    // keep the real PATH out of reach of a globally installed claude
    const r = runPipeline({ ...s.env({ ...base, SHARED_TOKEN: 'shared' }), PATH: `${path.join(s.root, 'bin')}:/usr/bin:/bin` });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('claude CLI not found');
  });
  it('passes the brief and stop point as separate arguments and returns the pipeline exit code', () => {
    const s = sandbox({ pipelineExit: 3 });
    const r = runPipeline(s.env({ ...base, SHARED_TOKEN: 'shared' }));
    expect(r.status).toBe(3);
    // the multi-line issue text is ONE argument ([Title~~Body text]); the number and stop point are separate ones
    expect(s.calls().some(c => c.includes('[start] [Title~~Body text] [7] [--until] [analyzer]'))).toBe(true);
  });
  it('requires its inputs', () => {
    const s = sandbox();
    expect(runPipeline(s.env({ LANE: 'short' })).status).not.toBe(0);
  });
});

describe('trigger-buddy.sh', () => {
  function withCurl(exit: number) {
    const s = sandbox();
    const out = path.join(s.root, 'curl.log');
    fs.writeFileSync(path.join(s.root, 'bin', 'curl'), `#!/usr/bin/env bash\necho "$@" > "${out}"\nexit ${exit}\n`, { mode: 0o755 });
    return { s, out };
  }
  const trigger = (env: Record<string, string>) => spawnSync('bash', [path.join(routeDir, 'trigger-buddy.sh')], { env, encoding: 'utf-8' });

  it('posts the issue number to the webhook without printing the secret URL', () => {
    const { s, out } = withCurl(0);
    const r = trigger(s.env({ BUDDY_WEBHOOK_URL: 'https://app.buddy.works/hook/SECRET', ISSUE_NUMBER: '7' }));
    expect(r.status).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toContain('"key":"ISSUE_NUMBER","value":"7"');
    expect(fs.readFileSync(out, 'utf-8')).toContain('https://app.buddy.works/hook/SECRET');
    expect(r.stdout + r.stderr).not.toContain('SECRET');
  });
  it('fails without printing the URL when the call fails', () => {
    const { s } = withCurl(22);
    const r = trigger(s.env({ BUDDY_WEBHOOK_URL: 'https://app.buddy.works/hook/SECRET', ISSUE_NUMBER: '7' }));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain('SECRET');
  });
  it('rejects a non-numeric issue and a missing URL', () => {
    const { s } = withCurl(0);
    expect(trigger(s.env({ BUDDY_WEBHOOK_URL: 'https://x', ISSUE_NUMBER: '7; rm -rf /' })).status).toBe(2);
    expect(trigger(s.env({ ISSUE_NUMBER: '7' })).status).not.toBe(0);
  });
});

describe('burst.sh', () => {
  const burst = (env: Record<string, string>) => spawnSync('bash', [path.join(routeDir, 'burst.sh')], { env, encoding: 'utf-8' });
  const vars = { GH_TOKEN: 'gh-token', GITHUB_REPOSITORY: 'o/r', CLAUDE_CODE_OAUTH_TOKEN: 'acct', BUDDY_EXECUTION_ID: '42', BUDDY_EXECUTION_URL: 'https://buddy/run/42' };

  it('runs the pipeline for the issue from the webhook and hands it back', () => {
    const s = sandbox();
    const r = burst(s.env({ ...vars, ISSUE_NUMBER: '7' }));
    expect(r.status).toBe(0);
    const calls = s.calls();
    expect(calls).toContain('creds OAUTH=acct API= GITHUB_TOKEN=');
    const finish = calls.find(c => c.startsWith('finish '))!;
    expect(finish).toContain('JOB_RESULT=success');
    expect(finish).toContain('LANE=burst');
    expect(finish).toContain('RUN_URL=https://buddy/run/42');
    expect(finish).toMatch(/START_EPOCH=\d+/);
    expect(calls.some(c => c.includes('[start]') && c.includes('[--until] [analyzer]'))).toBe(true);
  });
  it('falls back to finding the claimed burst issue when the webhook carried no number', () => {
    const s = sandbox();
    expect(burst(s.env(vars)).status).toBe(0);
    expect(s.calls().some(c => c.includes('find-burst'))).toBe(true);
    expect(s.calls().some(c => c.includes('[9] [--until] [analyzer]'))).toBe(true);
  });
  it('reports failure to the issue and exits non-zero when the pipeline fails', () => {
    const s = sandbox({ pipelineExit: 1 });
    const r = burst(s.env({ ...vars, ISSUE_NUMBER: '7' }));
    expect(r.status).toBe(1);
    expect(s.calls().find(c => c.startsWith('finish '))).toContain('JOB_RESULT=failure');
  });
  it('stops early without credentials or required variables', () => {
    const s = sandbox();
    const noClaudeAuth = burst(s.env({ GH_TOKEN: 'g', GITHUB_REPOSITORY: 'o/r', ISSUE_NUMBER: '7' }));
    expect(noClaudeAuth.status).toBe(1);
    expect(s.calls().find(c => c.startsWith('finish '))).toContain('JOB_RESULT=failure');
    expect(burst(s.env({ GITHUB_REPOSITORY: 'o/r' })).status).not.toBe(0);
  });
});

describe('workflow wiring', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'route.yml'), 'utf-8');
  it('the burst job runs only for the burst lane and the agent job skips it', () => {
    expect(route).toContain("needs.route.outputs.lane == 'burst'");
    expect(route).toContain("needs.route.outputs.lane != 'burst'");
    expect(route).toContain('trigger-buddy.sh');
  });
  it('passes the Buddy settings to the router', () => {
    expect(route).toContain('BUDDY_ENABLED: ${{ vars.BUDDY_ENABLED }}');
    expect(route).toContain('BUDDY_WEBHOOK_URL: ${{ secrets.BUDDY_WEBHOOK_URL }}');
  });
});
