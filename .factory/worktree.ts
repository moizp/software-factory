import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A per-run git worktree: builders write files here, the factory commits after each node. */
export interface RunWorktree {
  repoDir: string;
  dir: string;
  branch: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

export function createRunWorktree(repoDir: string, runId: string, baseRef = 'HEAD'): RunWorktree {
  const branch = `factory/${runId}`;
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'factory-wt-')), runId);
  git(repoDir, 'worktree', 'add', '-q', '-b', branch, dir, baseRef);
  return { repoDir, dir, branch };
}

/** Commits everything in the worktree with a single-line message. Returns the sha, or null if nothing changed. */
export function commitAll(wt: RunWorktree, message: string): string | null {
  if (message.includes('\n')) throw new Error('Commit messages must be a single line');
  git(wt.dir, 'add', '-A');
  if (git(wt.dir, 'status', '--porcelain') === '') return null;
  git(wt.dir, '-c', 'user.name=software-factory', '-c', 'user.email=factory@users.noreply.github.com', 'commit', '-q', '-m', message);
  return git(wt.dir, 'rev-parse', 'HEAD');
}

export function changedFiles(wt: RunWorktree, baseRef: string): string[] {
  const out = git(wt.dir, 'diff', '--name-only', `${baseRef}...HEAD`);
  return out ? out.split('\n') : [];
}

export function removeRunWorktree(wt: RunWorktree): void {
  git(wt.repoDir, 'worktree', 'remove', '--force', wt.dir);
}
