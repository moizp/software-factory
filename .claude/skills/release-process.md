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
