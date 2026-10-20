import * as fs from 'fs';
import * as path from 'path';
import { Exec, exec, tail } from '../exec';
import { Check, Ctx, Result, fail, pass, skip, warn } from '../types';

export const REQUIRED_LABELS = ['agent:ready', 'agent:working', 'agent:review', 'agent:failed', 'needs-human', 'policy:auto', 'policy:manual'];
const LABEL_COLOURS: Record<string, string> = { 'agent:ready': '0e8a16', 'agent:working': 'fbca04', 'agent:review': '1d76db', 'agent:failed': 'b60205', 'needs-human': 'd93f0b', 'policy:auto': '0e8a16', 'policy:manual': 'e99695' };
const WORKFLOWS = ['route.yml', 'agent-job.yml', 'answer.yml', 'sweep.yml', 'policy-check.yml', 'pr-lint.yml', 'factory-test.yml'];

const gh = (ctx: Ctx, args: string[]): Exec => exec('gh', args, { cwd: ctx.projectDir, timeoutMs: 60_000 });
const json = <T>(r: Exec): T | null => { try { return JSON.parse(r.stdout) as T; } catch { return null; } };
const authenticated = (ctx: Ctx): boolean => gh(ctx, ['auth', 'status']).code === 0;
/** A row that does not apply: not asked for, or gh cannot see GitHub at all (the auth row says why). */
const off = (ctx: Ctx, needsAuth = true): Result | null => {
  if (!ctx.flags.github) return skip('not asked for', 'Add `--github` to check the repository through gh (read-only)');
  if (needsAuth && !authenticated(ctx)) return skip('gh is not logged in (see github.auth)', 'Run `gh auth login`, then run the GitHub checks again');
  return null;
};

/** Looks at the repository through `gh`. Read-only, except `--create-labels`. Prints names of secrets, never values. */
export const githubChecks: Check[] = [
  {
    id: 'github.auth',
    tier: 'github',
    title: 'gh is logged in and the project has a GitHub repository',
    run: ctx => {
      const o = off(ctx, false); if (o) return o;
      const auth = gh(ctx, ['auth', 'status']);
      if (auth.missing) return fail('gh CLI not found', undefined, 'Install the GitHub CLI');
      if (auth.code !== 0) return fail('gh is not logged in', tail(auth.stderr + auth.stdout, 6), 'Run `gh auth login`');
      const repo = json<{ nameWithOwner: string; defaultBranchRef?: { name: string }; isPrivate: boolean }>(gh(ctx, ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,isPrivate']));
      return repo ? pass(`${repo.nameWithOwner} (${repo.isPrivate ? 'private' : 'public'}), default branch ${repo.defaultBranchRef?.name ?? '?'}`) : fail('gh could not read a repository from this directory', undefined, 'Run the check inside a clone of the project, or pass --project <dir>');
    }
  },
  {
    id: 'github.labels',
    tier: 'github',
    title: 'The labels the lanes use exist',
    run: ctx => {
      const o = off(ctx); if (o) return o;
      const have = json<Array<{ name: string }>>(gh(ctx, ['label', 'list', '--limit', '200', '--json', 'name']));
      if (!have) return fail('could not list labels', undefined, 'Check `gh auth status` and that this is a GitHub repository');
      const names = new Set(have.map(l => l.name));
      const missing = REQUIRED_LABELS.filter(l => !names.has(l));
      if (missing.length === 0) return pass(`all ${REQUIRED_LABELS.length} present`);
      if (ctx.flags.createLabels) {
        const failed = missing.filter(l => gh(ctx, ['label', 'create', l, '--color', LABEL_COLOURS[l] ?? 'ededed', '--description', 'Software factory']).code !== 0);
        return failed.length === 0 ? pass(`created ${missing.length} missing label(s): ${missing.join(', ')}`) : fail(`could not create: ${failed.join(', ')}`);
      }
      return fail(`missing: ${missing.join(', ')}`, undefined, 'Re-run with `--github --create-labels` to create them');
    }
  },
  {
    id: 'github.workflows',
    tier: 'github',
    title: 'The factory workflows are in the repository and enabled',
    run: ctx => {
      const o = off(ctx); if (o) return o;
      const dir = path.join(ctx.projectDir, '.github', 'workflows');
      const absent = WORKFLOWS.filter(w => !fs.existsSync(path.join(dir, w)));
      const listed = json<Array<{ path: string; state: string }>>(gh(ctx, ['workflow', 'list', '--all', '--json', 'path,state']));
      const disabled = (listed ?? []).filter(w => WORKFLOWS.some(f => w.path.endsWith(f)) && w.state !== 'active').map(w => path.basename(w.path));
      if (absent.length) return fail(`not in the repository: ${absent.join(', ')}`, undefined, 'Copy them from the factory (.github/workflows) and merge');
      if (!listed || listed.length === 0) return warn('files are present, but GitHub lists no workflows (not pushed to the default branch yet?)', undefined, 'Push the workflows to the default branch');
      return disabled.length ? warn(`present but not active: ${disabled.join(', ')}`, undefined, 'Enable them under Actions in the repository') : pass(`${WORKFLOWS.length} present and active`);
    }
  },
  {
    id: 'github.secrets',
    tier: 'github',
    title: 'Secrets and variables the lanes read are set (names only)',
    run: ctx => {
      const o = off(ctx); if (o) return o;
      const secrets = json<Array<{ name: string }>>(gh(ctx, ['secret', 'list', '--json', 'name']));
      const vars = json<Array<{ name: string }>>(gh(ctx, ['variable', 'list', '--json', 'name']));
      if (!secrets || !vars) return warn('could not list secrets or variables (the token may lack the admin scope)', undefined, 'Check them by hand under Settings > Secrets and variables > Actions');
      const s = secrets.map(x => x.name), v = vars.map(x => x.name);
      const note = `secrets: ${s.join(', ') || 'none'}; variables: ${v.join(', ') || 'none'}`;
      return v.includes('AGENTS_ENABLED') ? pass(note) : warn(`${note}. AGENTS_ENABLED is not set`, undefined, 'Set the variable AGENTS_ENABLED to true to let the lanes run (docs/CLOUD-RUNNERS.md)');
    }
  },
  {
    id: 'github.protection',
    tier: 'github',
    title: 'The default branch is protected',
    run: ctx => {
      const o = off(ctx); if (o) return o;
      const repo = json<{ nameWithOwner: string; defaultBranchRef?: { name: string } }>(gh(ctx, ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']));
      if (!repo) return skip('no repository');
      const r = gh(ctx, ['api', `repos/${repo.nameWithOwner}/branches/${repo.defaultBranchRef?.name ?? 'main'}/protection`]);
      if (r.code === 0) return pass('branch protection is on');
      return warn('no branch protection (or it cannot be read on this plan); the workflows and labels enforce the policy instead', tail(r.stderr, 3), 'On a free private repository GitHub cannot enforce it; see docs/POLICY.md');
    }
  },
  {
    id: 'github.issue',
    tier: 'github',
    title: 'Timeline of one issue',
    run: ctx => {
      const o = off(ctx); if (o) return o;
      if (!ctx.flags.issue) return skip('no issue given', 'Add `--issue <number>` to summarise what the lanes did for that issue');
      const n = String(ctx.flags.issue);
      const issue = json<{ state: string; title: string; labels: Array<{ name: string }>; comments: Array<{ author: { login: string }; createdAt: string; body: string }> }>(gh(ctx, ['issue', 'view', n, '--json', 'state,title,labels,comments']));
      if (!issue) return fail(`could not read issue #${n}`);
      const runs = json<Array<{ name: string; status: string; conclusion: string; createdAt: string; url: string }>>(gh(ctx, ['run', 'list', '--limit', '10', '--json', 'name,status,conclusion,createdAt,url']));
      const lines = [
        `labels: ${issue.labels.map(l => l.name).join(', ') || 'none'}`,
        ...issue.comments.slice(-8).map(c => `${c.createdAt} ${c.author.login}: ${c.body.split('\n')[0].slice(0, 160)}`),
        '',
        ...(runs ?? []).map(r => `${r.createdAt} ${r.name}: ${r.conclusion || r.status} ${r.url}`)
      ];
      return pass(`#${n} "${issue.title}" is ${issue.state}, ${issue.comments.length} comment(s)`, lines.join('\n'));
    }
  }
];
