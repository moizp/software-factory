import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  KNOWN_REQUIREMENTS, Policy, STRICT_POLICY, evaluatePolicy, globToRegExp, loadPolicy, parsePolicy, prInfoFromGit
} from '../policy-engine';
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
    ['non-boolean auto_merge', { ...repoPolicy, rules: [{ match: { branch: ['x'] }, auto_merge: 'yes' }] }],
    ['an unknown default requirement', { ...repoPolicy, default: { ...repoPolicy.default, require: ['ci', 'reviewer-verdict'] } }],
    ['an unknown rule requirement', { ...repoPolicy, rules: [{ match: { branch: ['x'] }, auto_merge: true, require: ['ai_review'] }] }]
  ])('rejects %s', (_name, raw) => {
    expect(() => parsePolicy(raw)).toThrow(/Invalid policy/);
  });

  it('says which requirement it cannot check and which it can', () => {
    expect(() => parsePolicy({ ...repoPolicy, default: { ...repoPolicy.default, require: ['ci', 'ai_review'] } }))
      .toThrow('default.require names ai_review, which the merge step cannot check (known: ci, reviewer_verdict)');
    expect(() => parsePolicy({ ...repoPolicy, rules: [{ name: 'x', match: { branch: ['x'] }, auto_merge: true, require: ['reviewer-verdict'] }] }))
      .toThrow('rules[0]');
  });

  it('only names requirements that the merge step runs, here and in the shipped templates', () => {
    expect(KNOWN_REQUIREMENTS).toEqual(['ci', 'reviewer_verdict']);
    for (const file of [path.join('.factory', 'policy.json'), path.join('templates', 'monorepo', 'policy.json')]) {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf-8'));
      expect(() => parsePolicy(raw)).not.toThrow();
    }
  });
});

describe('evaluatePolicy (repo policy)', () => {
  it('auto-merges docs-only changes, no human approval needed', () => {
    const d = evaluatePolicy(repoPolicy, pr({ files: ['docs/a.md', 'TODO.md'] }));
    expect(d.autoMerge).toBe(true);
    expect(d.approvals).toBe(0);
    expect(d.require).toContain('ci');
  });

  it('agents merge a code change after the review cycle: ci and the reviewer verdict are required, nobody else', () => {
    const d = evaluatePolicy(repoPolicy, pr({ files: ['docs/a.md', 'src/app.ts'] }));
    expect(d.autoMerge).toBe(true);
    expect(d.approvals).toBe(0);
    expect(d.require).toEqual(expect.arrayContaining(['ci', 'reviewer_verdict']));
    expect(d.reasons.join()).toMatch(/default: nothing protected changed/);
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

  it('feature and fix branches merge the same way: size and branch name do not call for a person', () => {
    for (const branch of ['feature/x', 'fix/typo', 'enhancement/y']) {
      expect(evaluatePolicy(repoPolicy, pr({ branch, files: ['src/a.ts'], changedLines: 20 })).autoMerge).toBe(true);
    }
    const many = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    expect(evaluatePolicy(repoPolicy, pr({ branch: 'feature/big', files: many, changedLines: 3000 })).autoMerge).toBe(true);
  });

  it('asks a person only when something absolutely needs one: protected paths, a label, an empty diff', () => {
    const needsPerson = [
      pr({ files: ['src/a.ts', '.github/workflows/x.yml'] }),
      pr({ files: ['src/a.ts'], labels: ['needs-human'] }),
      pr({ files: [] })
    ];
    for (const p of needsPerson) expect(evaluatePolicy(repoPolicy, p).autoMerge).toBe(false);
  });

  it('can still be told that some branches need a person, for a project that wants it', () => {
    const careful = parsePolicy({
      ...repoPolicy,
      rules: [{ name: 'releases need a person', match: { branch: ['release/*'] }, auto_merge: false }]
    });
    expect(evaluatePolicy(careful, pr({ branch: 'release/v1.2.0', files: ['src/a.ts'] })).autoMerge).toBe(false);
    expect(evaluatePolicy(careful, pr({ branch: 'fix/x', files: ['src/a.ts'] })).autoMerge).toBe(true);
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

  it('falls back to the strict policy, where a person merges, when the base policy names a requirement nothing can check', () => {
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'typo');
    fs.writeFileSync(path.join(dir, '.factory', 'policy.json'), JSON.stringify({ ...repoPolicy, default: { ...repoPolicy.default, require: ['ci', 'reveiwer_verdict'] } }));
    git('commit', '-q', '-am', 'typo in the policy');
    const loaded = loadPolicy('typo', dir);
    expect(loaded).toEqual(STRICT_POLICY);
    expect(evaluatePolicy(loaded, { branch: 'feature/y', files: ['src/a.ts'], changedLines: 3, labels: [] }).autoMerge).toBe(false);
    git('checkout', '-q', 'feature/x');
  });

  it('lists changed files and lines, so a PR editing the policy is caught', () => {
    const info = prInfoFromGit('main', 'feature/x', 'feature/x', [], dir);
    expect(info.files.sort()).toEqual(['.factory/policy.json', 'README.md']);
    expect(info.changedLines).toBeGreaterThan(0);
    expect(evaluatePolicy(loadPolicy('main', dir), info).autoMerge).toBe(false);
  });
});

describe('policy CLI', () => {
  // Guards against module resolution clashes (ts-node resolves .json before .ts)
  it('runs under ts-node and reports a protected-path change as manual', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-cli-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, '.factory'));
    fs.writeFileSync(path.join(dir, '.factory', 'policy.json'), JSON.stringify(repoPolicy));
    fs.writeFileSync(path.join(dir, 'README.md'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'chore/x');
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    git('add', '-A');
    git('commit', '-q', '-m', 'change');

    const cli = path.join(__dirname, '..', 'policy-cli.ts');
    const out = execFileSync(
      path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node'),
      [cli, '--base', 'main', '--head', 'chore/x', '--branch', 'chore/x'],
      { cwd: dir, encoding: 'utf-8' }
    );
    const decision = JSON.parse(out);
    expect(decision.autoMerge).toBe(false);
    expect(decision.reasons.join()).toMatch(/protected paths changed: package.json/);
  }, 60000);
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

  it('merges with a merge commit, never squash or rebase', async () => {
    const api = new GitHubAPI('token');
    await api.autoMergePR(5);
    expect((api as any).octokit.pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 5, merge_method: 'merge' })
    );
  });

  it('adds a label to a PR', async () => {
    const api = new GitHubAPI('token');
    await api.addLabel(5, 'needs-human');
    expect((api as any).octokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 5, labels: ['needs-human'] })
    );
  });

  it('says so when a label cannot be added', async () => {
    const api = new GitHubAPI('token');
    (api as any).octokit.issues.addLabels.mockRejectedValue(new Error('403'));
    await expect(api.addLabel(5, 'needs-human')).rejects.toThrow('Failed to add label: 403');
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
    postComment: jest.fn().mockResolvedValue(undefined),
    addLabel: jest.fn().mockResolvedValue(undefined)
  });

  const run = async (api: any, reviewerValid = true, policy: Policy = repoPolicy) => {
    const orchestrator = new FactoryOrchestrator(async () => ({ phase: 'x' as any, valid: true }), false);
    const o = orchestrator as any;
    o.githubAPI = api;
    o.prNumber = 7;
    o.loadBasePolicy = () => policy;
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

  it('merges a code change after a valid review and green CI, with no person involved', async () => {
    const api = makeApi({ branch: 'feature/x', files: ['src/a.ts', 'src/a.test.ts'], changedLines: 120, labels: [] });
    const state = await run(api, true);
    expect(api.autoMergePR).toHaveBeenCalledWith(7);
    expect(api.postComment).not.toHaveBeenCalled();
    expect(api.addLabel).not.toHaveBeenCalled();
    expect(state.notes.join()).toMatch(/auto-merged/);
  });

  it('does not merge when CI fails or never reports, and asks a person with the question on top', async () => {
    for (const ci of ['failure', 'none', 'pending']) {
      const api = makeApi({ branch: 'chore/x', files: ['docs/a.md'], changedLines: 3, labels: [] }, ci);
      const state = await run(api);
      expect(api.autoMergePR).not.toHaveBeenCalled();
      expect(api.postComment).toHaveBeenCalledWith(7, expect.stringMatching(/^## A person is needed: merge decision\n\n\*\*.*CI/));
      expect(api.addLabel).toHaveBeenCalledWith(7, 'needs-human');
      expect(state.notes.join()).toMatch(/Asked a person about the merge/);
    }
  });

  it('leaves protected changes to a human and puts the question and the reason on the PR', async () => {
    const api = makeApi({ branch: 'chore/x', files: ['.github/workflows/a.yml'], changedLines: 3, labels: [] });
    const state = await run(api);
    expect(api.autoMergePR).not.toHaveBeenCalled();
    const body = api.postComment.mock.calls[0][1] as string;
    expect(body).toMatch(/^## A person is needed: merge decision/);
    expect(body).toContain('**Please review and merge this PR (1 approval).**');
    expect(body).toContain('- protected paths changed: .github/workflows/a.yml');
    expect(api.addLabel).toHaveBeenCalledWith(7, 'needs-human');
    expect(state.notes.join()).toMatch(/human merge/);
  });

  it('does not merge without a valid reviewer verdict, and asks whether to send it back or merge anyway', async () => {
    const api = makeApi({ branch: 'fix/x', files: ['src/a.ts'], changedLines: 3, labels: [] });
    const state = await run(api, false);
    expect(api.autoMergePR).not.toHaveBeenCalled();
    expect(api.postComment).toHaveBeenCalledWith(7, expect.stringContaining('The reviewer did not approve this change. Send it back for fixes, or merge it anyway?'));
    expect(api.addLabel).toHaveBeenCalledWith(7, 'needs-human');
    expect(state.notes.join()).toMatch(/reviewer verdict is not valid/);
  });

  it('asks a person to merge by hand when the merge call itself fails', async () => {
    const api = makeApi({ branch: 'fix/x', files: ['src/a.ts'], changedLines: 3, labels: [] });
    api.autoMergePR.mockRejectedValue(new Error('405 not mergeable'));
    const state = await run(api, true);
    expect(api.postComment).toHaveBeenCalledWith(7, expect.stringContaining('the merge call failed: 405 not mergeable'));
    expect(api.addLabel).toHaveBeenCalledWith(7, 'needs-human');
    expect(state.notes.join()).toMatch(/Auto-merge failed/);
  });

  it('still finishes the run when the question cannot be posted', async () => {
    const api = makeApi({ branch: 'chore/x', files: ['.github/workflows/a.yml'], changedLines: 3, labels: [] });
    api.postComment.mockRejectedValue(new Error('403'));
    api.addLabel.mockRejectedValue(new Error('403'));
    const state = await run(api);
    expect(state.notes.join()).toMatch(/Asked a person about the merge/);
  });

  it('can be told to merge nothing without a person, for a project that wants it', async () => {
    const strict = parsePolicy({ ...repoPolicy, default: { auto_merge: false, approvals: 1, require: ['ci'] } });
    const api = makeApi({ branch: 'fix/x', files: ['src/a.ts'], changedLines: 3, labels: [] });
    await run(api, true, strict);
    expect(api.autoMergePR).not.toHaveBeenCalled();
    expect(api.addLabel).toHaveBeenCalledWith(7, 'needs-human');
  });

  it('fails closed when PR info cannot be read', async () => {
    const api = makeApi({});
    api.getPRInfo.mockRejectedValue(new Error('boom'));
    const state = await run(api);
    expect(api.autoMergePR).not.toHaveBeenCalled();
    expect(state.notes.join()).toMatch(/could not evaluate policy/);
  });
});

describe('monorepo policy template (templates/monorepo/policy.json)', () => {
  const monorepo = parsePolicy(
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'monorepo', 'policy.json'), 'utf-8'))
  );
  const change = (branch: string, files: string[], changedLines = 20) => ({ branch, files, changedLines, labels: [] });

  it('lets agents merge a change inside one service after review', () => {
    const d = evaluatePolicy(monorepo, change('fix/billing-rounding', ['services/billing/src/invoice.ts']));
    expect(d.autoMerge).toBe(true);
    expect(d.require).toEqual(expect.arrayContaining(['ci', 'reviewer_verdict']));
  });

  it.each([
    ['a fix that also touches shared libs', ['services/billing/src/a.ts', 'libs/shared-types/index.ts']],
    ['a fix that touches contracts', ['services/billing/src/a.ts', 'contracts/billing/openapi.yaml']],
    ['a fix that adds a migration', ['services/billing/migrations/002.sql']],
    ['a fix that touches another service', ['services/billing/src/a.ts', 'services/auth/src/b.ts']],
    ['a fix that edits the deploy script', ['services/billing/scripts/deploy.sh']]
  ])('needs a human for %s', (_name, files) => {
    expect(evaluatePolicy(monorepo, change('fix/billing-x', files)).autoMerge).toBe(false);
  });

  it('always needs a human for the auth service', () => {
    expect(evaluatePolicy(monorepo, change('fix/auth-token', ['services/auth/src/t.ts'])).autoMerge).toBe(false);
  });

  it('treats a feature branch in one service like a fix: only the protected paths and the auth rule call for a person', () => {
    expect(evaluatePolicy(monorepo, change('feature/billing-x', ['services/billing/src/a.ts'])).autoMerge).toBe(true);
    expect(evaluatePolicy(monorepo, change('feature/billing-x', ['services/auth/src/a.ts'])).autoMerge).toBe(false);
  });

  it('keeps docs-only changes automatic', () => {
    expect(evaluatePolicy(monorepo, change('chore/docs', ['docs/a.md', 'services/billing/README.md'])).autoMerge).toBe(true);
  });
});
