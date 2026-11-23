# Release Process Skill

How generated apps are released. The infrastructure-engineer copies `templates/release/` into the app repo and implements `scripts/deploy.sh` for the app's platform. The factory repo itself does not deploy sites.

## Flow

```
main ── Release Start ──> release/vX.Y.Z  (+ draft PR → main = release tracker)
                              │ fixes: PRs targeting release/vX.Y.Z
                              ▼
        Promote: RC → www-test → www-demo → www-prod   (fast-forward pointers)
                              │
        Release Finish: tag vX.Y.Z on the shipped commit, merge RC back to main, delete RC
```

## Versioning

The version is a number the project declares in `package.json`, `package-lock.json` (both of its fields) and `CHANGELOG.md`, and a tag `vX.Y.Z` on the shipped commit. `scripts/version.cjs` (copied from `templates/release/scripts/`, no dependencies) keeps them in step.

- **Choosing it.** From the conventional commits since the last tag: a breaking change (`type!:` or a `BREAKING CHANGE:` line) is major, `feat` is minor, `fix` and `perf` are patch. Before 1.0.0 a breaking change is minor and a feature is patch. Docs, chore, test, ci, style, build and refactor commits alone mean nothing to release. `node scripts/version.cjs next` shows the answer and why.
- **Writing it.** Release Start with the version left empty works it out, creates `release/vX.Y.Z`, and commits `chore: release vX.Y.Z` on it: `package.json`, `package-lock.json` and a new `CHANGELOG.md` section (breaking changes, features, fixes, performance). A person can type a version instead, which wins, and is how a hotfix or a release with only chores is made.
- **Checking it.** Release Finish runs `node scripts/version.cjs check --version X.Y.Z` before it tags: the lock file, `package.json` and the changelog must all say this release, so the tag and the files never disagree. `npm run verify` shows the same disagreement as `project.version`.
- **Review the changelog.** It is generated from commit subjects, so it is only as clear as they are; a person reads it in the release pull request and edits it there.
- **Never** edit the version by hand in one file, tag without the check, or reuse a tag.

## Rules

- `main` is the trunk; short-lived branches PR into it. There is no `develop`.
- **One release candidate at a time.** Release Start fails if a `release/*` branch is open or if `www-test` is not contained in the base (the previous release was not merged back).
- `www-test`, `www-demo`, `www-prod` are fast-forward pointers. Only the Promote workflow moves them, and only after the deploy succeeded, so `git log www-prod` is what is live.
- Promotion order is enforced: demo needs the same commit on `www-test` with `deploy/test` success; prod needs the same commit on `www-demo` with `deploy/demo` success, and the version retyped in `confirm`.
- A fix on the RC after test or demo means promoting again from test (the commit changed).
- Tag the commit that shipped (the RC tip on `www-prod`), then merge back to `main`. Do not tag the merge commit.
- Rollback: revert on the RC (or `main` plus a new RC) and promote forward. Never force-push `www-*`.
- Hotfix: Release Start with `base` set to the last tag (e.g. `v1.4.0`) and the patch version.

## Free-plan limits (private repo)

- No branch protection or Environment approvals, so the rules above are enforced by the workflows, not by GitHub. Anyone with write access could push to `www-*`; the deploy path never trusts the branch, it re-checks the commit and statuses.
- Secrets are repo-wide. Name them `TEST_*`, `DEMO_*`, `PROD_*`; Promote passes only the matching one.
- Pushes made with `GITHUB_TOKEN` do not trigger other workflows, so Promote deploys itself instead of relying on a push trigger.

## Deploy contract

`scripts/deploy.sh <env> <sha>` with `DEPLOY_ENV`, `DEPLOY_SHA`, `DEPLOY_TOKEN`. Exit 0 only when deployed and healthy (run a health check before returning). The platform (Vercel, Netlify, Cloudflare Pages, VPS over SSH, ...) comes from the app's `project.config.json`.

## Tracking

The draft release PR holds the checklist and receives a comment per promotion. Filter: `is:pr is:open is:draft head:release/`.
