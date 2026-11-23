import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PublishOptions {
  /** The project checkout: its remote says where pictures go. */
  cwd: string;
  remote?: string;
  /** An orphan branch that holds only pictures. Pushes are plain, never forced. */
  branch?: string;
  issue: number;
  /** The commit the "after" pictures show (the PR head). */
  commit: string;
  /** The directory capture wrote into: it holds before/ and after/. */
  outDir: string;
}

export interface Published {
  /** The commit on the evidence branch that holds the pictures. */
  commit: string;
  prefix: string;
  slug: string | null;
  urlFor(label: 'before' | 'after', file: string): string;
}

const NOBODY = ['-c', 'user.name=software-factory', '-c', 'user.email=software-factory@users.noreply.github.com'];

const hideCredentials = (text: string): string => text.replace(/\/\/[^/@\s]+@/g, '//[redacted]@');

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: hideCredentials((r.stderr ?? '').trim()) };
}

/** "owner/repo" from a GitHub remote URL, or null for anything else (a local path in tests). */
export function slugOf(url: string): string | null {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.replace(/\/\/[^/@\s]+@/, '//'));
  return m ? `${m[1]}/${m[2]}` : null;
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
}

/**
 * Commits the before and after pictures to the evidence branch under issue-<n>/<commit>/ and pushes. Main and the PR
 * branch stay free of images. Returns where each picture can be linked from a pull request or an issue comment.
 */
export function publishEvidence(opts: PublishOptions): Published {
  if (!Number.isInteger(opts.issue) || opts.issue < 1) throw new Error('issue must be a positive whole number');
  if (!/^[0-9a-f]{7,40}$/.test(opts.commit)) throw new Error('commit must be a git commit id');
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'evidence';
  for (const label of ['before', 'after']) {
    if (!fs.existsSync(path.join(opts.outDir, label, 'manifest.json'))) throw new Error(`${path.join(opts.outDir, label)} has no manifest.json: run evidence:capture for "${label}" first`);
  }

  const url = git(opts.cwd, ['remote', 'get-url', remote]);
  if (!url.ok) throw new Error(`no remote named "${remote}" in ${opts.cwd}`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-evidence-'));
  try {
    const run = (args: string[]) => { const r = git(work, args); if (!r.ok) throw new Error(`git ${args[0]} failed: ${r.err}`); return r.out; };
    run(['init', '-q', '-b', branch]);
    run(['remote', 'add', 'origin', url.out]);
    const fetched = git(work, ['fetch', '-q', 'origin', branch]);
    if (fetched.ok) run(['checkout', '-q', '-B', branch, 'FETCH_HEAD']);

    const prefix = `issue-${opts.issue}/${opts.commit.slice(0, 7)}`;
    for (const label of ['before', 'after']) copyDir(path.join(opts.outDir, label), path.join(work, prefix, label));
    run(['add', '-A']);
    if (git(work, ['diff', '--cached', '--quiet']).ok === false) run([...NOBODY, 'commit', '-q', '-m', `evidence: issue ${opts.issue} at ${opts.commit.slice(0, 7)}`]);

    let pushed = git(work, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
    if (!pushed.ok) {
      // Another run pushed first: its pictures live under other paths, so replaying ours on top cannot conflict
      // (when the branch does not exist yet there is nothing to replay onto, and the second push stands alone)
      if (git(work, ['fetch', '-q', 'origin', branch]).ok) {
        const again = git(work, [...NOBODY, 'rebase', '-q', 'FETCH_HEAD']);
        if (!again.ok) throw new Error(`could not update the ${branch} branch: ${again.err}`);
      }
      pushed = git(work, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
    }
    if (!pushed.ok) throw new Error(`could not push the ${branch} branch: ${pushed.err}`);

    const head = run(['rev-parse', 'HEAD']);
    const slug = slugOf(url.out);
    return {
      commit: head,
      prefix,
      slug,
      urlFor: (label, file) => (slug ? `https://github.com/${slug}/blob/${head}/${prefix}/${label}/${file}?raw=true` : `${prefix}/${label}/${file}`)
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
