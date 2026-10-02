import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  Policy, STRICT_POLICY, evaluatePolicy, globToRegExp, loadPolicy, parsePolicy, prInfoFromGit
} from '../policy';
import { FactoryOrchestrator } from '../orchestrator';
import { GitHubAPI } from '../github-integration';
import { createWorkflowState } from '../state';

const repoPolicy: Policy = parsePolicy(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'policy.json'), 'utf-8'))
);

const pr = (over: Partial<{ branch: string; files: string[]; changedLines: number; labels: string[] }> = {}) => ({
  branch: 'chore/x', files: ['docs/a.md'], changedLines: 10, labels: [], ...over
});

describe('globToRegExp', () => {
  it.each([
    ['*.md', 'README.md', true],
    ['*.md', 'docs/a.md', false],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'docs/deep/a.md', true],
    ['docs/**', 'docs/a/b.md', true],
    ['docs/**', 'doc/a.md', false],
    ['fix/*', 'fix/login-bug', true],
    ['fix/*', 'fix/a/b', false],
    ['.github/**', '.github/workflows/x.yml', true],
    ['package.json', 'package.json', true],
    ['package.json', 'xpackage.json', false]
  ])('%s vs %s', (glob, value, expected) => {
    expect(globToRegExp(glob).test(value)).toBe(expected);
  });
});

describe('parsePolicy', () => {
  it('accepts the repo policy', () => {
    expect(repoPolicy.version).toBe(1);
  });

  it.each([
    ['not an object', null],
    ['bad version', { ...repoPolicy, version: 2 }],
    ['missing default', { ...repoPolicy, default: undefined }],
    ['protected_paths not an array', { ...repoPolicy, protected_paths: 'x' }],
    ['rule without match', { ...repoPolicy, rules: [{ auto_merge: true }] }],
    ['rule with empty match', { ...repoPolicy, rules: [{ match: {}, auto_merge: true }] }],
    ['negative max_files', { ...repoPolicy, rules: [{ match: { max_files: -1 }, auto_merge: true }] }],
    ['non-boolean auto_merge', { ...repoPolicy, rules: [{ match: { branch: ['x'] }, auto_merge: 'yes' }] }]
  ])('rejects %s', (_name, raw) => {
    expect(() => parsePolicy(raw)).toThrow(/Invalid policy/);
  });
});

describe('evaluatePolicy (repo policy)', () => {
  it('auto-merges docs-only changes, no human approval needed', () => {
    const d = evaluatePolicy(repoPolicy, pr({ files: ['docs/a.md', 'TODO.md'] }));
    expect(d.autoMerge).toBe(true);
    expect(d.approvals).toBe(0);
    expect(d.require).toContain('ci');
  });

  it('needs a human when a non-doc file is included', () => {
    const d = evaluatePolicy(repoPolicy, pr({ files: ['docs/a.md', 'src/app.ts'] }));
    expect(d.autoMerge).toBe(false);
    expect(d.approvals).toBe(1);
  });

  it.each([
    '.github/workflows/factory-test.yml',
    '.factory/policy.json',
    '.factory/orchestrator.ts',
    '.claude/CLAUDE.md',
    'CONTRIBUTING.md',
    'package.json',
    'templates/release/scripts/deploy.sh'
  ])('protected path %s always needs a human, even next to docs', file => {
    const d = evaluatePolicy(repoPolicy, pr({ files: ['docs/a.md', file] }));
    expect(d.autoMerge).toBe(false);
    expect(d.reasons.join()).toMatch(/protected/);
  });

  it('a protected markdown file cannot ride the docs rule', () => {
    expect(evaluatePolicy(repoPolicy, pr({ files: ['.claude/skills/x.md'] })).autoMerge).toBe(false);
  });

  it('feature branches default to a human', () => {
    expect(evaluatePolicy(repoPolicy, pr({ branch: 'feature/x', files: ['src/a.ts'] })).autoMerge).toBe(false);
  });

  it('small fixes outside protected paths auto-merge with ci and reviewer_verdict required', () => {
    const d = evaluatePolicy(repoPolicy, pr({ branch: 'fix/typo', files: ['src/a.ts'], changedLines: 20 }));
    expect(d.autoMerge).toBe(true);
    expect(d.require).toEqual(expect.arrayContaining(['ci', 'reviewer_verdict']));
  });

  it('large fixes need a human', () => {
    expect(evaluatePolicy(repoPolicy, pr({ branch: 'fix/big', files: ['src/a.ts'], changedLines: 301 })).autoMerge).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`);
    expect(evaluatePolicy(repoPolicy, pr({ branch: 'fix/wide', files: many })).autoMerge).toBe(false);
  });

  it('the needs-human label can only tighten', () => {
    const d = evaluatePolicy(repoPolicy, pr({ labels: ['needs-human'] }));
    expect(d.autoMerge).toBe(false);
    expect(d.reasons.join()).toMatch(/label/);
  });

  it('fails closed on an empty diff', () => {
    expect(evaluatePolicy(repoPolicy, pr({ files: [] })).autoMerge).toBe(false);
  });
});

describe('evaluatePolicy (rule semantics)', () => {
  const base: Policy = {
    version: 1,
    default: { auto_merge: false, approvals: 1 },
    protected_paths: [],
    rules: []
  };

  it('strictest rule wins: an explicit human rule beats an allow rule', () => {
    const policy: Policy = {
      ...base,
      rules: [
        { name: 'allow', match: { branch: ['chore/*'] }, auto_merge: true },
        { name: 'deny', match: { paths_any: ['db/**'] }, auto_merge: false, approvals: 2 }
      ]
    };
    const d = evaluatePolicy(policy, pr({ files: ['db/migrate.sql'] }));
    expect(d.autoMerge).toBe(false);
    expect(d.approvals).toBe(2);
  });

  it('default auto_merge true applies when nothing forbids it', () => {
    const d = evaluatePolicy({ ...base, default: { auto_merge: true, approvals: 1 } }, pr());
    expect(d.autoMerge).toBe(true);
  });

  it('strict fallback policy never auto-merges', () => {
    expect(evaluatePolicy(STRICT_POLICY, pr()).autoMerge).toBe(false);
  });
});

describe('loadPolicy and prInfoFromGit', () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-git-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, '.factory'));
    fs.writeFileSync(path.join(dir, '.factory', 'policy.json'), JSON.stringify(repoPolicy));
    fs.writeFileSync(path.join(dir, 'README.md'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature/x');
    // The PR tries to loosen the policy and edit docs
    fs.writeFileSync(path.join(dir, '.factory', 'policy.json'), JSON.stringify({ ...repoPolicy, protected_paths: [] }));
    fs.writeFileSync(path.join(dir, 'README.md'), 'a\nb\n');
    git('commit', '-q', '-am', 'change');
  });

  it('reads the policy from the base ref, not the PR head', () => {
    expect(loadPolicy('main', dir).protected_paths.length).toBeGreaterThan(0);
    expect(loadPolicy('feature/x', dir).protected_paths).toEqual([]);
  });

  it('falls back to the strict policy when the ref has no policy', () => {
    expect(loadPolicy('does-not-exist', dir)).toEqual(STRICT_POLICY);
  });

  it('lists changed files and lines, so a PR editing the policy is caught', () => {
    const info = prInfoFromGit('main', 'feature/x', 'feature/x', [], dir);
    expect(info.files.sort()).toEqual(['.factory/policy.json', 'README.md']);
    expect(info.changedLines).toBeGreaterThan(0);
    expect(evaluatePolicy(loadPolicy('main', dir), info).autoMerge).toBe(false);
  });
});

describe('GitHubAPI policy helpers', () => {
  it('reads PR info', async () => {
    const api = new GitHubAPI('token');
    const info = await api.getPRInfo(5);
    expect(info).toEqual({
      branch: 'fix/x',
      headSha: 'abc123',
      labels: ['agent'],
      files: ['docs/a.md', 'README.md'],
      changedLines: 6
    });
  });

  it.each([
    [[], 'none'],
    [[{ status: 'completed', conclusion: 'success' }], 'success'],
    [[{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }], 'pending'],
    [[{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }], 'failure']
  ])('check summary %j is %s', async (runs, expected) => {
    const api = new GitHubAPI('token');
    (api as any).octokit.checks.listForRef.mockResolvedValue({ data: { check_runs: runs } });
    expect(await api.getCheckSummary('sha')).toBe(expected);
  });
});

describe('Orchestrator auto-merge gating', () => {
  const makeApi = (info: any, ci: string = 'success') => ({
    getPRInfo: jest.fn().mockResolvedValue({ headSha: 'sha', ...info }),
    getCheckSummary: jest.fn().mockResolvedValue(ci),
    autoMergePR: jest.fn().mockResolvedValue(undefined),
    postComment: jest.fn().mockResolvedValue(undefined)
  });

  const run = async (api: any, reviewerValid = true) => {
    const orchestrator = new FactoryOrchestrator(async () => ({ phase: 'x' as any, valid: true }), false);
    const o = orchestrator as any;
    o.githubAPI = api;
    o.prNumber = 7;
    o.loadBasePolicy = () => repoPolicy;
    process.env.FACTORY_CI_POLL_MS = '1';
    process.env.FACTORY_CI_TIMEOUT_MS = '5';
    let state = createWorkflowState('brief');
    state = { ...state, phases: [{ phase: 'reviewer', valid: reviewerValid, timestamp: '' }] };
    return o.maybeAutoMerge(state);
  };

  afterEach(() => {
    delete process.env.FACTORY_CI_POLL_MS;
    delete process.env.FACTORY_CI_TIMEOUT_MS;
  });

  it('merges a docs-only PR once CI is green', async () => {
    const api = makeApi({ branch: 'chore/x', files: ['docs/a.md'], changedLines: 3, labels: [] });
    const state = await run(api);
    expect(api.autoMergePR).toHaveBeenCalledWith(7);
    expect(state.notes.join()).toMatch(/auto-merged/);
  });

  it('does not merge when CI fails or never reports', async () => {
    for (const ci of ['failure', 'none', 'pending']) {
      const api = makeApi({ branch: 'chore/x', files: ['docs/a.md'], changedLines: 3, labels: [] }, ci);
      await run(api);
      expect(api.autoMergePR).not.toHaveBeenCalled();
    }
  });

  it('leaves protected changes to a human and explains why on the PR', async () => {
    const api = makeApi({ branch: 'chore/x', files: ['.github/workflows/a.yml'], changedLines: 3, labels: [] });
    const state = await run(api);
    expect(api.autoMergePR).not.toHaveBeenCalled();
    expect(api.postComment).toHaveBeenCalledWith(7, expect.stringContaining('protected paths'));
    expect(state.notes.join()).toMatch(/human merge/);
  });

  it('requires a valid reviewer verdict for small fixes', async () => {
    const info = { branch: 'fix/x', files: ['src/a.ts'], changedLines: 3, labels: [] };
    const bad = makeApi(info);
    await run(bad, false);
    expect(bad.autoMergePR).not.toHaveBeenCalled();
    const good = makeApi(info);
    await run(good, true);
    expect(good.autoMergePR).toHaveBeenCalled();
  });

  it('fails closed when PR info cannot be read', async () => {
    const api = makeApi({});
    api.getPRInfo.mockRejectedValue(new Error('boom'));
    const state = await run(api);
    expect(api.autoMergePR).not.toHaveBeenCalled();
    expect(state.notes.join()).toMatch(/could not evaluate policy/);
  });
});
