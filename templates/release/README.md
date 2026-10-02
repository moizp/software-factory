# Release process template

Copy this folder's contents into an app repository (the infrastructure-engineer agent does this for generated apps). Process and rules: `.claude/skills/release-process.md`.

```
templates/release/.github/workflows/release-start.yml   → .github/workflows/
templates/release/.github/workflows/promote.yml         → .github/workflows/
templates/release/.github/workflows/release-finish.yml  → .github/workflows/
templates/release/scripts/deploy.sh                     → scripts/deploy.sh   (implement per platform)
```

One-time setup in the app repo:
- Settings → Actions → General → Workflow permissions: **Read and write**, and tick **Allow GitHub Actions to create and approve pull requests** (needed for the draft release PR).
- Secrets: `TEST_DEPLOY_TOKEN`, `DEMO_DEPLOY_TOKEN`, `PROD_DEPLOY_TOKEN` (whatever your platform needs).
- Do not push to `www-*` by hand; only **Promote** moves them.
