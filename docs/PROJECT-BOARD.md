# Project Board

The repo and every app built with the factory follow one Kanban template, defined in `.factory/board.json`. Issues and PRs live in a GitHub Project that mirrors it, so agents and humans see the same work and the same limits.

```
Backlog → Ready → In progress → In review → Done
          (agent:ready)  (draft PR)  (ready PR)
                          WIP 1        WIP 2
```

## Rules

| Status | Means | WIP limit |
|---|---|---|
| Backlog | New issue or PR | none |
| Ready | Issue labelled `agent:ready` (an agent may take it) | none |
| In progress | Open **draft** PR | **1** |
| In review | Open PR that is ready for review; a human merges unless labelled `policy:auto` | **2** |
| Done | PR merged or issue closed | none |

- **Finish before starting.** New work starts only when In progress is below 1 and In review is below 2. A full review column means humans are the bottleneck, so stop starting and clear it.
- **The limits are enforced for agents.** Before a new workflow starts, the orchestrator counts open PRs (drafts are In progress, the rest In review) and refuses to start if a limit is reached. Resuming a failed workflow is not new work. Set `FACTORY_IGNORE_WIP=1` to start anyway.
- **Why so low.** The scarce resources are human review time and the Claude plan's tokens. One piece of work at a time keeps both predictable. Raise the numbers in `.factory/board.json` when the review queue is consistently empty.
- Counts include human-authored PRs, so the limits are repo-wide.

## What is in the config

`.factory/board.json` is the source of truth for: statuses and WIP limits, project fields (Phase, Area, Priority, Tokens), views (Board, Needs me, Active agent work, Roadmap, Done this week), labels and milestones.

| Part | Applied how |
|---|---|
| Labels and milestones | Automatically by `.github/workflows/board-sync.yml` on every change to `board.json` on `main` (or run it manually) |
| WIP limits | Enforced by the orchestrator (above) |
| The Project, its fields and views | Created once in the GitHub UI (agent tools cannot create Projects); see below |

## Creating the Project (once per repo)

1. GitHub → Projects → New project → start from the **Kanban / Board** template.
2. Rename the statuses to match `board.json` (Backlog, Ready, In progress, In review, Done).
3. Add the fields from `board.json`: Phase, Area, Priority (single select) and Tokens (number).
4. Create the views from `board.json`, using each view's `filter` and `group_by`.
5. Settings → Workflows: auto-add items from this repo; item added → Backlog; PR merged and issue closed → Done.
6. Link the Project to the repo, then run the **Board Sync** workflow once to create the labels and milestones.
7. Whether workflows may update a user-owned Project with the default token is unverified. If not, a token with `project` scope is needed (tracked in `TODO.md`).

## For apps built with the factory

The infrastructure-engineer copies `.factory/board.json` and `.github/workflows/board-sync.yml` into the app repo and follows the same steps. Apps may change the Phase/Area options and the WIP limits, but should keep the statuses and the `agent:ready`, `needs-human`, `policy:auto` and `policy:manual` labels, because the merge policy and the orchestrator rely on them.

## Cadence

A short weekly pass: clear **Needs me**, reorder **Ready**, and look at cycle time (issue to merge), the share of `policy:auto` merges, and tokens per merged PR.
