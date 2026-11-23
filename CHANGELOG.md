# Changelog

All notable changes to this project. Versions follow [semantic versioning](https://semver.org); each section after 1.0.0 is written by `npm run version:bump` from the conventional commits since the previous release.

## [1.0.0] - 2026-11-23

The first release. It is the pipeline, the working practices around it and the checks that prove them, as they stand today.

From 1.0.0, a change to any of these is a breaking change and bumps the major version: the agent contracts (`.factory/contracts`, the payload keys in `.factory/pipeline.ts`), the merge policy format (`.factory/policy.json`), the project declaration files (`MISSION.md`, `CHARACTER.md`, `LOOKFEEL.md`, `docs/wiki/glossary.md`, `project.config.json` keys the factory reads), and the `npm run` commands the docs name.

### Features
- **Pipeline.** Ten headless agents, product manager to customer support, with validated JSON handoffs, repair re-asks, typed questions to a person, plan approval, a token cap, an event log and handoff files.
- **Declarations.** Mission, character, look and feel, ubiquitous language, wiki and project `CLAUDE.md`, each written with a skill and checked by a command, then handed to the agents.
- **Working practices.** Trunk-based flow, a merge policy read from `main`, Kanban limits, PR text, commit and test-selection gates, release-candidate flow with promotion through test, demo and prod.
- **Cloud lanes.** Issues labelled `agent:ready` are routed to hosted, self-hosted or burst runners.
- **Proof.** `npm run verify` checks the environment, the contracts, a project's declarations and the policy, and runs the whole pipeline with a model-free agent; `--live` and `--github` add the real model and the repository.
- **Web apps.** SvelteKit with Tailwind by default, a framework-free core for shared code, a CSS budget, a tested developer-experience template, MCP servers chosen by stack, before and after pictures for interface changes, few and current dependencies.
- **Versioning.** `npm run version:next`, `version:bump` and `version:check` choose the next version from conventional commits and keep `package.json`, `package-lock.json` and this file in step; generated apps get the same in `templates/release/`.

### Known limits
- Builders return file lists, not code: no branch, commit or pull request is written (F6 and T1 in `docs/NEXT-CAPABILITIES.md`).
- The GitHub lanes, the dependency workflows and the release workflows have not run end to end in GitHub Actions.
- `npm run verify --live` runs the real product manager (`--live=plan`, through the architect); a full ten-agent run against the real model has not been checked.
