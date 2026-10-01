# Contributing to Software Factory

This document outlines the git flow branching strategy and contribution process for the Software Factory project.

## Git Flow Branching Model

We follow the **Git Flow** branching model. This ensures organized development, controlled releases, and easy hotfixes.

### Branch Structure

```
main (production)
  ↑
  └─ release/* (release preparation)
       ↓
develop (integration)
  ↑
  ├─ feature/* (new features)
  ├─ enhancement/* (improvements)
  ├─ fix/* (bug fixes)
  └─ chore/* (refactoring, deps)
       ↓
```

### Branch Naming Conventions

**Feature branches** (new functionality):
```
feature/short-description
feature/add-mcp-configurator
feature/implement-backend-builder
```

**Enhancement branches** (improvements to existing features):
```
enhancement/short-description
enhancement/improve-parallel-execution
enhancement/optimize-state-persistence
```

**Fix/Bug branches** (bug fixes):
```
fix/short-description
fix/orchestrator-timeout-handling
fix/artifact-collection-issue
```

**Chore branches** (refactoring, dependencies, docs):
```
chore/short-description
chore/update-typescript-config
chore/add-jest-fixtures
```

**Hotfix branches** (urgent fixes to production, created from `main`):
```
hotfix/short-description
hotfix/security-credential-leak
hotfix/critical-orchestrator-crash
```

### Branch Lifecycle

#### 1. Creating a Feature Branch

```bash
# Start from develop (always)
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/your-feature-name

# Add branch spec (controls automation & review requirements)
cp .branchspec.json.example .branchspec.json
# Edit .branchspec.json with your requirements
nano .branchspec.json

# Make changes, commit, and push
git add . .branchspec.json
git commit -m "feat: your feature description"
git push -u origin feature/your-feature-name

# Validate branch spec
npm run validate:branchspec
```

**What's a branch spec?** See [BRANCH-SPEC.md](./docs/BRANCH-SPEC.md) for complete guide on controlling automation, review requirements, and merge behavior.

#### 2. Committing Changes

Follow these **conventional commit** rules:

```
<type>: <description>

<optional body>
<optional footer>
```

**Types:**
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `chore:` — Build, deps, refactoring
- `test:` — Adding/updating tests
- `ci:` — CI/CD pipeline changes
- `perf:` — Performance improvements
- `refactor:` — Code restructuring (no behavior change)

**Examples:**
```bash
git commit -m "feat: add mcp-configurator agent"
git commit -m "fix: resolve parallel phase artifact collection"
git commit -m "docs: update git flow instructions"
git commit -m "chore: upgrade typescript to 5.4"
git commit -m "test: add integration tests for orchestrator"
```

**Rules:**
- ✅ Single-line commit messages (max 50 characters)
- ✅ Imperative mood ("add", not "added")
- ✅ No periods at end
- ✅ Reference issues: `feat: fix issue #123`
- ❌ Never force-push to shared branches (only feature branches)

#### 3. Creating a Pull Request

Once your feature is ready:

```bash
# Push your branch
git push origin feature/your-feature-name

# Create PR on GitHub
# - Title: Use the commit message format
# - Description: What, why, how
# - Link issues: "Closes #123" or "Fixes #456"
# - Target: develop (not main!)
```

**PR Template:**

```markdown
## What
Brief description of changes

## Why
Why this change is needed

## How
Implementation approach

## Testing
How to verify the changes work

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] Follows git flow conventions
- [ ] Commits are clean and well-formatted

Fixes #123
```

#### 4. Code Review & Approval

- All PRs require at least **1 approval** before merging
- Address review comments or reply with explanation
- Push fixes as new commits (don't amend approved commits)
- Re-request review after making changes

#### 5. Merging to Develop

```bash
# Option A: Squash & merge (recommended for features)
# Keeps develop history clean

# Option B: Create a merge commit
# Preserves feature branch history
git checkout develop
git pull origin develop
git merge --no-ff feature/your-feature-name
git push origin develop

# Delete feature branch
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

---

## Workflow Examples

### Adding a New Agent

```bash
# 1. Create feature branch
git checkout develop
git pull origin develop
git checkout -b feature/add-skeptical-reviewer-agent

# 2. Make changes
# - Create .claude/agents/skeptical-reviewer.md
# - Update .claude/CLAUDE.md
# - Add tests in .factory/__tests__/

# 3. Commit
git add .claude/agents/skeptical-reviewer.md .claude/CLAUDE.md .factory/__tests__/
git commit -m "feat: add skeptical-reviewer agent for code audits"

# 4. Push & create PR
git push -u origin feature/add-skeptical-reviewer-agent
# Create PR on GitHub, target: develop

# 5. After approval, merge
git checkout develop
git pull origin develop
git merge --no-ff feature/add-skeptical-reviewer-agent
git push origin develop
git branch -d feature/add-skeptical-reviewer-agent
git push origin --delete feature/add-skeptical-reviewer-agent
```

### Fixing a Bug in Develop

```bash
# 1. Create fix branch from develop
git checkout develop
git pull origin develop
git checkout -b fix/artifact-collection-parallel-phases

# 2. Fix the bug
# - Update .factory/orchestrator.ts
# - Add test case in .factory/__tests__/orchestrator.test.ts

# 3. Commit
git commit -m "fix: collect artifacts correctly in parallel phases"

# 4. Test locally
npm test
npm run build

# 5. Push & create PR
git push -u origin fix/artifact-collection-parallel-phases
# Create PR on GitHub

# 6. After approval, merge
git checkout develop
git pull origin develop
git merge --no-ff fix/artifact-collection-parallel-phases
git push origin develop
```

### Preparing a Release

```bash
# 1. Create release branch from develop
git checkout develop
git pull origin develop
git checkout -b release/v1.2.0

# 2. Update version numbers & CHANGELOG
# - Update package.json version to 1.2.0
# - Update version in CHANGELOG.md
# - Final testing & docs updates

# 3. Commit & tag
git commit -m "chore: bump version to 1.2.0"

# 4. Merge to main (production)
git checkout main
git pull origin main
git merge --no-ff release/v1.2.0
git tag -a v1.2.0 -m "Release version 1.2.0"
git push origin main --tags

# 5. Merge back to develop
git checkout develop
git merge --no-ff release/v1.2.0
git push origin develop

# 6. Delete release branch
git branch -d release/v1.2.0
git push origin --delete release/v1.2.0
```

### Hotfix for Production

```bash
# 1. Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/security-fix-v1.2.1

# 2. Fix the critical issue
# - Update .factory/orchestrator.ts or affected file
# - Add test case

# 3. Commit & bump patch version
git commit -m "fix: critical security vulnerability in credential handling"

# 4. Merge to main
git checkout main
git merge --no-ff hotfix/security-fix-v1.2.1
git tag -a v1.2.1 -m "Hotfix: security vulnerability"
git push origin main --tags

# 5. Merge back to develop
git checkout develop
git merge --no-ff hotfix/security-fix-v1.2.1
git push origin develop

# 6. Delete hotfix branch
git branch -d hotfix/security-fix-v1.2.1
git push origin --delete hotfix/security-fix-v1.2.1
```

---

## Branch Protection Rules

The following rules are enforced on GitHub:

### `develop` Branch
- ✅ Require pull request reviews (1 approval minimum)
- ✅ Dismiss stale PR approvals
- ✅ Require branches to be up to date before merging
- ✅ Require status checks to pass (tests, linting)
- ✅ Require code reviews before merge
- ❌ No force-push allowed

### `main` Branch
- ✅ Require pull request reviews (2 approvals minimum)
- ✅ Dismiss stale PR approvals
- ✅ Require branches to be up to date before merging
- ✅ Require status checks to pass
- ✅ Require signed commits
- ❌ No force-push allowed
- ℹ️ Only merge from `release/*` and `hotfix/*` branches

---

## Common Tasks

### Update your feature branch with latest develop

```bash
git fetch origin
git rebase origin/develop
git push origin feature/your-feature --force-with-lease
```

### Accidentally committed to develop instead of a branch?

```bash
# Create a new branch from current HEAD
git branch feature/your-feature

# Reset develop to origin
git checkout develop
git reset --hard origin/develop
```

### Delete a local branch

```bash
# Delete safely (only if merged)
git branch -d feature/your-feature

# Force delete
git branch -D feature/your-feature
```

### View all branches and their status

```bash
# Local branches
git branch -v

# Remote branches
git branch -rv

# All branches
git branch -av
```

---

## Dos and Don'ts

### ✅ DO

- Create branches for **all changes** (even small ones)
- Use descriptive branch names
- Keep commits small and focused
- Write clear commit messages
- Push frequently to prevent data loss
- Pull before pushing to avoid conflicts
- Review your own PR before requesting review
- Test locally before pushing
- Update develop before creating release/hotfix

### ❌ DON'T

- Commit directly to `develop` or `main`
- Force-push to shared branches
- Mix features in one branch/PR
- Use vague branch names (`fix/bug`, `feature/stuff`)
- Leave stale branches (delete after merging)
- Merge without approval
- Skip tests before pushing
- Ignore merge conflicts
- Rebase public history

---

## Setting Up Git Hooks

### Pre-commit Hook (Validate Branch Name)

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash

# Get current branch name
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)

# List of allowed prefixes
ALLOWED_PREFIXES="feature|enhancement|fix|chore|release|hotfix|main|develop"

# Check if branch name matches pattern
if ! [[ $BRANCH_NAME =~ ^($ALLOWED_PREFIXES)/.+ ]] && ! [[ $BRANCH_NAME =~ ^(main|develop)$ ]]; then
  echo "❌ Invalid branch name: $BRANCH_NAME"
  echo "✅ Use one of: feature/*, enhancement/*, fix/*, chore/*, release/*, hotfix/*"
  exit 1
fi

exit 0
```

Make executable:
```bash
chmod +x .git/hooks/pre-commit
```

---

## Need Help?

- **Git Flow Guide:** https://nvie.com/posts/a-successful-git-branching-model/
- **Conventional Commits:** https://www.conventionalcommits.org/
- **GitHub Flow:** https://guides.github.com/introduction/flow/

Questions? Ask in the project issues or reach out to the maintainers.

---

**Last Updated:** 2026-10-01
