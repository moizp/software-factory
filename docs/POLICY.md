# Merge Policy

One repo-level file, `.factory/policy.json`, decides which pull requests an agent may merge and which need a human. It replaces the old per-branch `.branchspec.json`.

```
PR → evaluate policy.json (read from main) against the PR → { auto_merge | human, approvals, required checks }
```

## Why it is read from `main`

The policy is always loaded from the base branch, never from the PR. A PR that edits the policy (or the evaluator) cannot loosen its own rules, and `.factory/**` is a protected path, so such a PR always needs a human anyway.

## File format

```json
{
  "version": 1,
  "default": { "auto_merge": true, "approvals": 1, "require": ["ci", "reviewer_verdict"] },
  "protected_paths": [".factory/**", ".github/**", ".claude/**", "package.json"],
  "force_manual_labels": ["needs-human"],
  "rules": [
    { "name": "docs only",
      "match": { "paths_only": ["**/*.md", "docs/**"], "max_files": 20 },
      "auto_merge": true }
  ]
}
```

**Agents merge after the review cycle.** By default a change that touches nothing protected merges itself once CI is green and the reviewer agent's verdict is valid; no person is involved. A person is asked only when something absolutely needs one: a protected path changed, a forcing label (`needs-human`) is on the PR, the diff is empty, a rule says so, the reviewer did not approve, CI did not finish green, or the merge call failed. The question is then put at the top of a PR comment ("A person is needed: merge decision", with the reason) and the PR gets the `needs-human` label. A project that wants a person on every merge sets `"default": { "auto_merge": false }`; the engine supports both.

| Field | Meaning |
|---|---|
| `default` | Applies when no rule matches. `auto_merge: true` lets agents merge after the checks in `require`; `auto_merge: false` means a human merges. |
| `protected_paths` | Globs. A PR touching any of them always needs a human, whatever the rules say. |
| `force_manual_labels` | A label that forces a human. Labels can only tighten, never loosen. |
| `rules[].match` | All listed conditions must hold: `branch` (globs), `paths_only` (every changed file matches), `paths_any` (at least one matches), `max_files`, `max_lines`. |
| `rules[].auto_merge` | `true` allows auto-merge, `false` forces a human. |
| `rules[].approvals` | Human approvals needed when the PR is not auto-merged. |
| `rules[].require` / `default.require` | Checks that must pass before merging: `ci` (all check runs green), `reviewer_verdict` (the reviewer agent returned `valid: true`). |

Globs: `*` matches within a directory, `**` crosses directories, `?` one character.

## Merging

Auto-merges use a merge commit, the same as human merges (see `CONTRIBUTING.md`).

## Evaluation rules

1. Empty diff, a protected path, or a forcing label means a human.
2. Any matching rule with `auto_merge: false` means a human (strictest wins).
3. Otherwise auto-merge if a matching rule allows it, or the default does.
4. When auto-merging, human approvals are 0. Otherwise `approvals` is the highest of the default and the matching rules.
5. Required checks are the union of the default and the matching rules.
6. Anything unreadable or invalid falls back to a strict policy: a human merges.

Agents never approve PRs. A reviewer-agent verdict is a required check, not an approval; it is the review cycle's result, and an independent AI review is planned to join it (`docs/NEXT-CAPABILITIES.md`, R5).

## Where it runs

| Where | What |
|---|---|
| `.factory/orchestrator.ts` | After a workflow succeeds, evaluates the policy for its PR, waits for CI if required, and merges only if allowed. Otherwise comments the reasons on the PR and leaves it open. |
| `.github/workflows/policy-check.yml` | On every PR to `main`, evaluates the policy using base-branch code and labels the PR `policy:auto` or `policy:manual`. Informational: the check itself always passes. |
| `npm run policy:check -- --base origin/main --head HEAD --branch "$(git branch --show-current)"` | Local dry run; prints the decision as JSON. |

## Free-plan caveat

Private repos on the free plan have no branch protection, so GitHub itself cannot block a manual merge. The policy governs what agents do and what the labels tell reviewers; a human with write access can still merge anything.

## Changing the policy

Open a PR. It always needs a human because `.factory/**` is protected, and it only takes effect once merged to `main`.

## Generated apps

The same file format works in app repos. Adjust `protected_paths` to what matters there (deploy scripts, migrations, auth, `.github/**`) and keep production promotion manual (see `.claude/skills/release-process.md`).
