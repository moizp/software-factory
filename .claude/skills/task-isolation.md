# Task Isolation Skill

Every agent that edits the repo works in its own worktree and branch. Read-only work (reviews, explanations, investigations) needs none. If an investigation turns into edits, isolate first.

## Flow

```
task starts
  ├─ read-only? ──────────────▶ use the current checkout, stop here
  ├─ worktree already assigned to this task? ─▶ keep it, skip to "Scope check"
  ▼
git fetch origin
  ▼
scope check (below)
  ├─ behavioral overlap or unclear ownership ─▶ stop, report, add `needs-human`
  ▼
git worktree add ../wt/<task> -b <prefix>/<task> origin/main
  ▼
verify: git branch --show-current prints the new branch, not main
```

## Naming

- Task name: lowercase-with-hyphens plus a short suffix, for example `user-auth-0816a`.
- Branch prefix follows `CONTRIBUTING.md` (`feature/`, `fix/`, `enhancement/`, `chore/`).
- If `git worktree add` fails because the name exists, pick another name. Never force or reuse.
- Put worktrees outside the checkout, or in a gitignored directory inside it.

## Scope check (before the first edit)

```bash
git fetch origin
git ls-remote --heads origin 'refs/heads/*'        # who else is working
# GitHub MCP: list open PRs, then list each PR's changed files
```

1. Collect the changed files of every open PR and the uncommitted work in shared checkouts (look, never touch).
2. Intersect with the files this task will change.
3. No overlap: go ahead.
4. Overlap in the same files: read both diffs. Independent edits (different functions, different sections) may proceed in your own worktree. Say so in the PR body.
5. Overlap in behavior, a dependency on unfinished work, or unclear ownership: stop. Report which PR, which files, and what the conflict is.

If PR tools are unavailable, say the scope check could not run, then isolate anyway.

## Multi-agent rules

- Never commit to `main`. One worktree and one branch per task and per agent.
- Never reuse, modify or switch another agent's worktree, branch or uncommitted work.
- Never plain `--force`. Never rewrite history on a shared branch. This repo merges with merge commits, so update a branch by merging `main` into it.
- Resolve lockfile conflicts by regenerating them with the package manager, never by hand.
- Worktrees do not isolate dev-server ports or shared databases. Check a port answers your process before trusting it. Do not run schema experiments against a shared database.
- If a conflict cannot be resolved with confidence, stop and report. Guessing costs more than asking.
- A request for a plan, review or experiment does not imply publishing it. Open a PR only when asked or when the pipeline stage calls for it.
- Keep the worktree until the PR is merged or closed, then remove it:

```bash
git worktree remove ../wt/<task>
git branch -d <prefix>/<task>      # -d works because merges are merge commits
```

## Proportionality

Pick the parts that apply. Docs-only changes need content and link checks, not runtime evidence. Code changes need the repo's checks and evidence of the behavior changed (see the PR template). Do not manufacture steps the change does not need.
