# Monorepo Setup (chosen layout) and Notes for Several Repos

Decision: all services live in one repository. This page is the layout and conventions, what each pipeline part does per service, and what to do later if you split into several repos. Templates are in `templates/monorepo/`.

## 1. Layout

```
repo/
  services/
    billing/            one folder per deployable service
      CLAUDE.md         scope, commands, conventions (service-template/CLAUDE.md)
      REVIEW.md         extra reviewer rules for this service (service-template/REVIEW.md)
      src/  tests/  migrations/  scripts/deploy.sh
    auth/
  libs/
    shared-types/       shared code; a change here affects every dependent service
  contracts/            API and event schemas between services
  docs/                 architecture notes and ADRs
  services.json         registry: name, path, owners, build, test, depends_on, release tag prefix, deploy
  .factory/policy.json  merge policy, with per-service rules and protected paths
  .github/CODEOWNERS    owners per path
```

Start from `templates/monorepo/`: copy `services.json`, `policy.json` (merge into the repo's `.factory/policy.json`), `CODEOWNERS.example`, and one `service-template/` per service.

## 2. Rules that keep the monorepo workable

1. **A service change touches one service.** Cross-service work is split: first a PR to `contracts/` (backwards compatible), then one PR per service.
2. **Services talk only through `contracts/`.** No imports between `services/*`. Shared code goes in `libs/` and is a deliberate, reviewed decision.
3. **`contracts/` and `libs/` are always human reviewed (R3).** They are one-way doors for every consumer.
4. **Branch names carry the service:** `feature/billing-invoice-export`, `fix/billing-rounding`. The merge policy and labels key off this.
5. **Every service has its own build and test command** in `services.json`, so CI can run only what changed.

## 3. How each pipeline part works per service

| Part | Monorepo behaviour |
|---|---|
| Writer VPS | One clone, one `git worktree` per task; `agent-session.sh` is given the branch `feature/<service>-<slug>`; the session's first message states the service and links `services/<name>/CLAUDE.md` |
| Gate A (build, test, scan) | Resolve changed files to services (plus dependents via `depends_on`, `libs/`, `contracts/`), then run only those services' commands as a matrix |
| Risk tier | Highest tier across changed services; touching two or more services, `libs/` or `contracts/` raises the floor to R2 or R3 (see the policy's `protected_paths`) |
| Gate B reviewer | Diff limited to changed services; prompt gets the repo's `00-system.md` plus each changed service's `REVIEW.md`; contracts changes get the architecture lens |
| Merge policy | Per-service rules in `policy.json` (example: agents merge after review by default, auth and the shared paths always need a person); engine reads paths, so no code change is needed for this |
| Board | Add a `Service` field to the Project; WIP limits stay repo-wide to start, per service lane later |
| Reviewers | `CODEOWNERS` requests the owning team; on a repo without protection it cannot block a merge |
| Cost | Reviewer cost scales with changed services, not repo size |

**Releases in a monorepo.** Start with one release train: `release/vX.Y.Z` covers the whole repo and the existing release templates work unchanged. When services need independent cadences, move to per-service tags and RC branches with a prefix (`billing/v1.4.0`, `release/billing/v1.4.0`) and one promote run per service. Decide when the first service needs to ship without the others.

**What the policy cannot express yet.** "This PR touches two services" is not a condition in the policy engine. It is covered today by listing shared paths as protected and by a small service resolver (Phase F in the plan) that reads `services.json`. Until then, a PR that spans services needs a human because it will normally touch `contracts/` or `libs/`; keep that discipline in review.

## 4. Keeping the option to split later (notes for several repos)

Everything above is chosen so a split is mostly mechanical. What carries over and what changes:

| Topic | In several repos |
|---|---|
| Per-repo files | Each repo gets its own `.factory/policy.json`, board config, workflows and `CLAUDE.md`; `docs/ADOPTING.md` is the checklist |
| Reviewer and prompts | One central repository holds the reviewer workflow as a reusable workflow (`workflow_call`) and the shared prompts; service repos call it and add their own `REVIEW.md` |
| Cross-service changes | Two PRs in two repos, merged in order (contract first). Contract tests in each consumer become the main safety net, because the reviewer no longer sees both sides in one diff |
| Shared code and schemas | `libs/` becomes versioned packages; `contracts/` becomes its own repo (or a published schema package) with semantic versions and a deprecation policy |
| Writer security | One fine-grained token per repo, so a confused session can only touch one service: a real improvement on an unprotected `main` |
| Releases | Independent per repo with the existing release templates, no prefixes needed |
| Board | One GitHub Project can span repos; add a `Repository` field |
| Cost | Same per-PR cost; setup effort repeats per repo, reduced by reusable workflows and a future `factory init` |

**Splitting recipe:** for each service, `git filter-repo --path services/<name>` (history preserved), move `services.json` entry data into that repo's config, replace `libs/` imports with published packages, publish `contracts/` first, then repoint CI.

**Habits that make a later split cheap (adopt now):**
- no imports between services; shared code only via `libs/` and `contracts/`
- every service builds and tests from its own folder with its own command
- per-service `CLAUDE.md`, `REVIEW.md`, deploy script and release tag prefix
- contract tests per consumer, not only per provider

**Signals to split:** a service needs a different access boundary (contractors, compliance), independent release cadence is blocked by the single train, CI time stays high despite path filtering, or a bad merge in one service keeps blocking others.
