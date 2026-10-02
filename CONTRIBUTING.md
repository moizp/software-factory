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

# 2. Branch spec (controls automation and review rules, see docs/BRANCH-SPEC.md)
cp .branchspec.json.example .branchspec.json     # edit scope, approvals, auto_merge
npm run validate:branchspec

# 3. Change, test, commit
npm run build && npm test
git add <files> .branchspec.json
git commit -m "feat: your feature description"

# 4. Push and open a PR targeting main
git push -u origin feature/your-feature-name
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
- Required: build and tests green. Respect the branch spec (`auto_merge`, approvals).
- Squash and merge is the default; delete the branch afterwards.

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

## Protection on the free plan

Private repos on the free plan have no branch protection or required reviews, so these rules are conventions plus CI (`factory-test.yml` runs on every PR to `main`). Never push directly to `main`; the one exception is a fast-forward that moves it to an already-reviewed commit.

## Dos and Don'ts

**Do:** branch for every change, keep PRs small and single-purpose, test locally first, delete merged branches.

**Don't:** commit directly to `main`, force-push shared branches, mix unrelated changes, skip tests, merge with failing checks.

## More

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Trunk Based Development](https://trunkbaseddevelopment.com/)
- `docs/BRANCH-SPEC.md` for the branch spec

**Last Updated:** 2026-10-02
