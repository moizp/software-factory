# Contributing to Software Factory

This repo is **trunk-based**: `main` is the only long-lived branch. Work happens on short-lived branches that merge into `main` through a pull request.

```
main (trunk, always releasable)
  ↑
  ├─ feature/*      new functionality
  ├─ enhancement/*  improvements to existing features
  ├─ fix/*          bug fixes
  └─ chore/*        refactoring, deps, docs, CI
```

## Releases

The factory itself has no release cadence and no deploy environments. `main` is the product; tag a version (`git tag -a vX.Y.Z`) only when you want a reference point.

Apps **built by** the factory do have a cadence: release candidate branches cut from `main`, promoted through `www-test` → `www-demo` → `www-prod`, tagged and merged back. That process, its workflow templates and the free-plan caveats are in `.claude/skills/release-process.md` and `templates/release/`. The infrastructure-engineer agent installs them into each generated app.

## Branch Naming

```
feature/add-mcp-configurator
enhancement/improve-parallel-execution
fix/orchestrator-timeout-handling
chore/update-typescript-config
```

Short, descriptive, lowercase, hyphenated. Never `fix/bug` or `feature/stuff`.

## Workflow

```bash
# 1. Branch from an up-to-date main
git checkout main && git pull origin main
git checkout -b feature/your-feature-name

# 2. Change, test, commit
npm run build && npm test
git add <files>
git commit -m "feat: your feature description"

# 3. Push and open a PR targeting main
git push -u origin feature/your-feature-name

# 4. See what the merge policy says about your change
npm run policy:check -- --base origin/main --head HEAD --branch "$(git branch --show-current)"
```

Keep branches small and short-lived (hours to a couple of days). To pick up newer `main`, merge it in (`git merge origin/main`); do not rewrite history on a pushed branch.

### Commit messages

Single line, conventional format, imperative mood, max 50 characters, no trailing period.

| Type | Use |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `chore:` | Build, deps, housekeeping |
| `test:` | Tests |
| `ci:` | CI/CD |
| `perf:` | Performance |
| `refactor:` | Restructuring, no behaviour change |

```bash
git commit -m "feat: add mcp-configurator agent"
git commit -m "fix: resolve parallel phase artifacts"
git commit -m "docs: update contributing guide"
```

Do not add attribution lines to commits or PRs ("Generated with Claude Code", `Co-Authored-By: Claude`, session links, model names).

### Pull requests

- **Target: `main`.**
- Title uses the commit format. Description: what, why, how, testing, checklist.
- Link issues with `Closes #123`.
- Required: build and tests green. The merge policy (`.factory/policy.json`, see `docs/POLICY.md`) decides whether it auto-merges or needs a human; the `policy-check` workflow labels the PR `policy:auto` or `policy:manual`.
- **Merge with a merge commit.** No squash, no rebase: the branch's commits stay in `main`'s history, merged branches show as fully merged, and humans and agents can trace a change back to its PR. This is why every commit is a single-line conventional message.
- Delete the branch afterwards.
- Suggested repo setting (Settings → General → Pull Requests): allow merge commits only, and enable "Automatically delete head branches".

```markdown
## What
## Why
## How
## Testing

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] Follows branching conventions
- [ ] Commits are clean and well-formatted
```

## Work tracking

Work lives in issues and PRs under a GitHub Project that follows the Kanban template in `.factory/board.json`: Backlog → Ready → In progress → In review → Done, with WIP limits of 1 (In progress, i.e. open draft PRs) and 2 (In review). Finish before starting new work. See `docs/PROJECT-BOARD.md`.

## Protection on the free plan

Private repos on the free plan have no branch protection or required reviews, so these rules are conventions plus CI (`factory-test.yml` runs the tests on Node 24 for any PR that touches `.factory/`, `.claude/`, `package*.json` or the TypeScript and Jest config; a docs-only PR skips it). Never push directly to `main`; the one exception is a fast-forward that moves it to an already-reviewed commit.

## Dos and Don'ts

**Do:** branch for every change, keep PRs small and single-purpose, test locally first, delete merged branches.

**Don't:** commit directly to `main`, force-push shared branches, mix unrelated changes, skip tests, merge with failing checks.

## More

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Trunk Based Development](https://trunkbaseddevelopment.com/)
- `docs/POLICY.md` for the merge policy

**Last Updated:** 2026-10-02
