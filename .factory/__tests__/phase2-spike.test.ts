import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { changedFiles, commitAll, createRunWorktree, removeRunWorktree } from '../worktree';
import { loopBack } from '../loopback';
import { buildBuilderArgs } from '../claude-bridge';

function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf-8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return dir;
}

describe('run worktree', () => {
  it('commits per node on its own branch and leaves the main checkout untouched', () => {
    const repo = scratchRepo();
    const wt = createRunWorktree(repo, 'run-1', 'main');
    expect(wt.branch).toBe('factory/run-1');

    fs.writeFileSync(path.join(wt.dir, 'a.js'), 'module.exports = 1;\n');
    const first = commitAll(wt, 'feat: add a');
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(commitAll(wt, 'feat: nothing changed')).toBeNull();

    fs.writeFileSync(path.join(wt.dir, 'b.js'), 'module.exports = 2;\n');
    commitAll(wt, 'feat: add b');

    expect(changedFiles(wt, 'main').sort()).toEqual(['a.js', 'b.js']);
    expect(fs.existsSync(path.join(repo, 'a.js'))).toBe(false);
    const log = execFileSync('git', ['log', '--format=%s', 'main..factory/run-1'], { cwd: repo, encoding: 'utf-8' });
    expect(log.trim().split('\n')).toEqual(['feat: add b', 'feat: add a']);

    removeRunWorktree(wt);
    expect(fs.existsSync(wt.dir)).toBe(false);
  });

  it('rejects multi-line commit messages', () => {
    const repo = scratchRepo();
    const wt = createRunWorktree(repo, 'run-2', 'main');
    fs.writeFileSync(path.join(wt.dir, 'a.js'), '1');
    expect(() => commitAll(wt, 'feat: a\n\nbody')).toThrow(/single line/);
  });
});

describe('loopBack', () => {
  it('passes after feedback and counts iterations', async () => {
    const feedbackSeen: Array<string | null> = [];
    let n = 0;
    const outcome = await loopBack({
      attempt: async (_i, feedback) => { feedbackSeen.push(feedback); },
      gate: async () => (++n < 3 ? { passed: false, feedback: `fail ${n}` } : { passed: true, feedback: '' }),
      maxIterations: 5
    });
    expect(outcome.status).toBe('passed');
    expect(outcome.iterations).toBe(3);
    expect(feedbackSeen).toEqual([null, 'fail 1', 'fail 2']);
  });

  it('escalates at the iteration cap', async () => {
    let n = 0;
    const outcome = await loopBack({
      attempt: async () => undefined,
      gate: async () => ({ passed: false, feedback: `different ${++n}` }),
      maxIterations: 3
    });
    expect(outcome).toMatchObject({ status: 'escalated', iterations: 3 });
    expect((outcome as any).reason).toMatch(/after 3 iterations/);
  });

  it('escalates early when the same failure repeats, saving tokens', async () => {
    const outcome = await loopBack({
      attempt: async () => undefined,
      gate: async () => ({ passed: false, feedback: 'same error' }),
      maxIterations: 5
    });
    expect(outcome).toMatchObject({ status: 'escalated', iterations: 2 });
    expect((outcome as any).reason).toMatch(/repeated/);
  });
});

describe('builder args', () => {
  it('restricts tools, accepts edits and caps spend', () => {
    const args = buildBuilderArgs(['Read', 'Write'], 0.25);
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Write');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('0.25');
    expect(args).toContain('--no-session-persistence');
  });
});
