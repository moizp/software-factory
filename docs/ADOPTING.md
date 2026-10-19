# Adopting the Factory in an Existing Project

The factory cannot yet change existing code (it has no change mode). What an existing project can adopt today is the factory's working practices: trunk-based flow with merge commits, a merge policy that decides what agents may merge, a Kanban board with WIP limits, and (if it has environments) the release-candidate flow.

## How to use

1. Open Claude Code in the existing project.
2. Give that session access to the private `moizp/software-factory` repo (attach it, or clone it read-only).
3. Paste the prompt below.

It first surveys the project and asks a few questions, then adopts one item per PR, in order, and stops at anything that needs you.

## The prompt

````text
You are adopting the working practices of the software-factory (repo: moizp/software-factory, branch main) into THIS existing project. Do not change application code. Work in small PRs, one at a time. Be economical with tokens: read only the files listed below, not the whole factory repo.

## Step 0: Recon (read-only, no changes yet)
Summarize in under 25 lines: language/stack, default branch, branching model in use, CI workflows, how it deploys (environments?), existing contribution/commit conventions, existing issue/PR templates, and whether the repo is private/free plan (no branch protection, no environment approvals).
Then ask me, in one message, only what you cannot infer:
1. Move to trunk-based on the default branch (short-lived branches, merge commits only)? Or keep the current model?
2. Which paths must always need a human (deploy, auth, migrations, CI, secrets, infra)?
3. Do we have separate test/demo/prod environments (then adopt the release flow) or not (skip it)?
4. WIP limits for the board (factory default: 1 in progress, 2 in review)?
Wait for my answers.

## Step 1: Read these factory files (via GitHub tools or a read-only clone)
- .factory/policy.json, .factory/policy-engine.ts, .factory/policy-cli.ts, docs/POLICY.md, .github/workflows/policy-check.yml
- .factory/board.json, .factory/board.ts, docs/PROJECT-BOARD.md, .github/workflows/board-sync.yml
- CONTRIBUTING.md and the "Trunk-Based Branching Strategy" section of .claude/CLAUDE.md
- (only if environments exist) .claude/skills/release-process.md and templates/release/**
- (optional) .claude/skills/feature-settings.md

## Step 2: Adopt in this order, one PR per item. Do not start the next until the previous PR is merged.
0. Mission (first, because everything planned afterwards is held to it): interview me, one question at a time, using `.claude/skills/mission.md` and `templates/project/MISSION.md`: who the users are, what they do today that we want to change, how we would see it happen, what we will refuse to build, and the mission in a sentence or two. Write `MISSION.md` in my words (never invent a user group, a number or a goal), run `npm run mission:check` or `npx ts-node .factory/mission-cli.ts` if the factory is installed, and add `MISSION.md` to the protected paths in step 2 so a mission change always needs me. Skip this step only if I say the project has no mission to declare yet.
0b. Character (after the mission is merged; skip only if the project has no product voice or behaviour to decide): read `.claude/skills/character.md` and `templates/project/CHARACTER.md`, and interview me one question at a time: who the users are and what state they are in, what they fear going wrong, three or four feelings from the skill's list, and any limits (an existing brand voice, culture and language, regulated moments). Shortlist with `npx ts-node .factory/character-cli.ts shortlist <feelings>`, give me three finalists with how each would behave at a mistake, a failure and a refusal in this product, and let me choose. Fill traits, values, relationship, every moment and boundaries with behaviour, not adjectives, cite the mission's behaviour changes and goals in the Why, write `CHARACTER.md`, check it with `npx ts-node .factory/character-cli.ts check`, and add `CHARACTER.md` to the protected paths.
0c. Look and feel (after the mission and character are merged; skip if the project has no user interface): read `.claude/skills/look-and-feel.md` and `templates/project/LOOKFEEL.md`, and interview me one question at a time: who uses the product, where, when, on what, in what mood; three or four feelings from the skill's list; any limits (existing brand, platform, accessibility, culture). Shortlist from the catalogue (`npx ts-node .factory/lookfeel-cli.ts shortlist <feelings>`), give me three finalists with what each means for materials, motion and sound in this product and what it risks for the mission, and let me choose a primary (and at most one secondary). Fill all six layers with values, not adjectives (hex colours with a readable pair, durations and easing, what never animates, whether there is sound at all and how it is turned off), cite the mission's behaviour changes and goals in the Why, write `LOOKFEEL.md`, check it with `npx ts-node .factory/lookfeel-cli.ts check`, and add `LOOKFEEL.md` to the protected paths so a change always needs me.
0d. Wiki (after the mission is merged): copy `templates/project/docs/wiki/` to `docs/wiki`, fill the draft pages from the repository with sources (never from guesses), set a page to current only after checking it against its sources, run `npm run wiki -- index --write` and `npm run wiki:check`, and ask me whether `docs/wiki/**` should be a protected path (it should be if agents will write to it).
1. Conventions: write the project's `CLAUDE.md` from `templates/project/CLAUDE.md` (five sections of succinct bullets, checked by `npm run claudemd:check`) and merge CONTRIBUTING.md. Keep what already exists; add: short-lived branches (feature/fix/enhancement/chore) from the default branch, PRs target it, single-line conventional commits (max 50 chars), merge commits only (no squash/rebase), delete branches after merge, NO attribution lines in commits or PRs (no "Generated with Claude Code", no Co-Authored-By: Claude, no session links). If a convention conflicts with an existing one, ask me.
2. Merge policy: copy .factory/policy.json, policy-engine.ts, policy-cli.ts and the policy-check workflow. Keep .factory/ self-contained with its own package.json (devDependencies: typescript, ts-node, @types/node) so application dependencies are untouched, and adapt the workflow's install/run commands to that. Edit policy.json: set protected_paths to what I told you in Q2 (always include .factory/**, .github/**, CLAUDE.md, CONTRIBUTING.md, MISSION.md, CHARACTER.md, LOOKFEEL.md, dependency manifests), keep the docs-only rule, drop or adapt the small-fix rule. Dry-run it: npx ts-node .factory/policy-cli.ts --base origin/<default> --head HEAD --branch <name> and show me the output for a docs-only change and a protected change.
3. Board: copy board.json (apply my WIP limits), board-sync.yml and docs/PROJECT-BOARD.md. Adjust Phase/Area options to this project. Do not create the GitHub Project (needs the UI); list the steps for me.
4. Release flow (only if Q3 = yes): copy templates/release/** and the release-process skill; write scripts/deploy.sh for this project's real deploy mechanism; ask me for the platform before writing it.
5. Optional: convert any existing TODO list into GitHub issues using the labels from board.json (agent:ready only on items an agent may take).

## Rules for every PR
- Branch from the default branch; commit single-line; run the project's own build/tests/linters and show they still pass; run the policy dry-run once step 2 exists.
- PR body: What / Why / How / Testing / Checklist. The PR tool may append a "Generated by Claude Code" footer on creation: immediately update the PR body to remove it.
- Never push to the default branch, never force-push, never change repo/branch-protection settings, never touch secrets, never edit application source.
- Merge only if the merge policy allows it (policy:auto label, required checks green); otherwise leave the PR for me. Exception: while the policy does not exist yet (before step 2 is merged), every PR waits for me.
- Only one PR open at a time (WIP limit); finish before starting.

## Known caveats from the factory
- The policy-check workflow reads code and policy from the base branch, so on the PR that introduces it, it fails closed (policy:manual). That is expected.
- On a free private repo GitHub cannot enforce any of this; the workflows and labels do.
- None of the workflows has run in this project yet; say so in each PR instead of claiming they work.

## Final report (after each PR and at the end)
What was adopted, what was skipped and why, what is unverified, and the manual steps left for me (create the Project in the GitHub UI, run Board Sync once, set repo merge-commit-only and auto-delete-head-branches settings, add deploy secrets named TEST_*, DEMO_*, PROD_*).
````

## Notes

- This adoption path has not been run on a real existing repository yet; expect small snags, mostly in the stack-specific workflow commands.
- It installs practices, not the factory's agents. Running the agents on existing code needs a change mode (repo ingestion, change analysis, patch-mode builders), which is on the roadmap.
- A future `factory init` command could do the file copying automatically.
