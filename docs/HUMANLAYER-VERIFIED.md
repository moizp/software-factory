# HumanLayer notes, checked against the docs site

`docs/HUMANLAYER-IDEAS.md` was written without access to https://docs.humanlayer.com. This file checks it claim by claim against that site, as read on 2026-10-20. Nothing in `HUMANLAYER-IDEAS.md` or `NEXT-CAPABILITIES.md` is changed here; the edits below are recommendations.

## What the site is now

The site documents one product: the HumanLayer app (macOS desktop app, web and mobile at app.humanlayer.com, a local or remote daemon that runs Claude Code or Codex sessions, and HumanLayer Cloud for tasks, sync and comments). Its workflows are packaged as `/rpi:*` skills (RPI, PRD-Oriented, Oneshot, Freeform). The site has no 12-Factor Agents material, no page or link for it, no SDK or approvals API pages, and no context-engineering write-up. So every claim in the notes that rests on a factor number, or on the older `.claude` commands in the GitHub repo, is "not found" here. That is not the same as wrong: those sources were not checked in this pass, as instructed.

## Pages read

All 24 pages in the site navigation were read in full (there is no sitemap.xml or llms.txt; both return 404). No other docs pages are linked from them. Not opened: external links (GitHub, Loom, YouTube, app.humanlayer.com, Anthropic docs) and the workflow infographic (`/skills-workflows-flow-light.png`, `/skills-workflows-flow-print.pdf`).

| URL | Title |
|---|---|
| https://docs.humanlayer.com/ | HumanLayer Docs |
| https://docs.humanlayer.com/tutorials/first-session | Quickstart - Running a HumanLayer Task |
| https://docs.humanlayer.com/tutorials/remote-daemon | Run a Task on a Remote Daemon |
| https://docs.humanlayer.com/guide/skills-workflows | Run a workflow in HumanLayer |
| https://docs.humanlayer.com/guide/workspaces | Workspace setup |
| https://docs.humanlayer.com/guide/automation-sessions | Run HumanLayer Sessions in Automations |
| https://docs.humanlayer.com/guide/remote-daemons | Run a Remote Daemon |
| https://docs.humanlayer.com/guide/local-daemon | Use remote hosts only |
| https://docs.humanlayer.com/guide/codex | Set Up Codex CLI |
| https://docs.humanlayer.com/guide/bedrock | Claude on AWS Bedrock |
| https://docs.humanlayer.com/guide/llm-gateways | Route Models Through an LLM Gateway |
| https://docs.humanlayer.com/guide/github-integration | Connect GitHub and Create Tasks from Issues |
| https://docs.humanlayer.com/guide/slack-integration | Send HumanLayer Updates to Slack |
| https://docs.humanlayer.com/guide/linear-integration | Connect Linear and Run Ticket Workflows |
| https://docs.humanlayer.com/guide/jira-integration | Connect Jira and Create Tasks from Tickets |
| https://docs.humanlayer.com/explanation/workflow-phases | How workflow phases fit together |
| https://docs.humanlayer.com/explanation/tasks | How HumanLayer tasks keep related work together |
| https://docs.humanlayer.com/explanation/workspace-model | How workspace configuration works |
| https://docs.humanlayer.com/explanation/remote-daemons | How Remote Daemons Work |
| https://docs.humanlayer.com/reference/skills-workflows | Skills and workflows reference |
| https://docs.humanlayer.com/reference/subagent-models | Sub-agent models and effort |
| https://docs.humanlayer.com/reference/system-prompt-additions | System prompt additions |
| https://docs.humanlayer.com/reference/workspace-config | Workspace config reference |
| https://docs.humanlayer.com/release-notes | Release Notes (0.101.7, June 6 2026, to 0.183.0, October 14 2026) |

Short names used below: `ref` = /reference/skills-workflows, `phases` = /explanation/workflow-phases, `auto` = /guide/automation-sessions, `linear` = /guide/linear-integration, `agents` = /reference/subagent-models, `notes` = /release-notes, `daemons` = /explanation/remote-daemons.

## Verdicts

Totals: 7 confirmed, 2 contradicted, 24 not found, 2 outdated (35 rows). Items with more than one checkable claim (A3, A4, A5, B1) are split into rows.

### Numbers in "Sources and how far to trust them"

| Claim | Verdict | Evidence |
|---|---|---|
| 35k lines in about 7 hours | Not found | No page mentions it |
| A bug fix in a 300k line codebase | Not found | No page mentions it |
| About $12k a month on Opus for three people (also in "One warning") | Not found | No page mentions it. The site has cost and token metrics in the app (notes 0.169.0, 0.175.0) but no spend figures |

### "What the factory already does that they recommend"

| Claim | Verdict | Evidence |
|---|---|---|
| Small focused agents, structured hand-offs (factors 10 and 4) | Not found | No factors on the site. Related: named specialist sub-agents (`agents`) and one artifact per phase (`ref`) |
| Own your prompts and control flow (factors 2 and 8) | Not found | No factors. Related: the site publishes the exact text it adds to the system prompt (/reference/system-prompt-additions) |
| Launch, pause, resume (factor 6) | Not found | No factors. Related: sessions survive host suspend and resume (`daemons`) |
| Trigger from anywhere (factor 11) | Not found | No factors. Related: tasks start from GitHub, Linear or Jira issues, CI, or the web and phone app |
| A human gate before the expensive part | Confirmed | "Planning puts key choices before implementation. Reviewers can change a short document faster than they can change a large pull request." (`phases`) |
| A cap on fix loops (three rounds) | Not found | No round limit on any page. The only "three" is sub-agent nesting depth (notes 0.161.0) |

### A. Cheap, high value

| Claim | Verdict | Evidence |
|---|---|---|
| A1 Typed requests for humans (factor 7): intent, question, options, urgency, answer format, pause and resume | Not found | No structured request format and no factors. Related: sessions wait for "a tool approval" (`daemons`), a notification bell lists "sessions waiting on you" (notes 0.181.0) |
| A2 Self-correcting retries (factor 9) | Not found | No page describes re-asking with the error or an error counter |
| A3 The plan is the review point; phases with automated and manual checks | Confirmed | The outline step "defines each phase's scope, files, tests, automated checks, and manual checks." (`ref`, /rpi:create-outline). The reviewed artifact is now the structure outline, not a detailed plan |
| A3 source `validate_plan` | Not found | No such command. The nearest is /rpi:describe-pr, which "reads the full diff and compares it with the plan" (`ref`) |
| A4 Handoff documents (tasks, key files, `file:line` changes, learnings, next steps, commit and branch in front matter) | Not found | No handoff-document format. The site does it differently: "Before you switch sessions, write every current decision from this session into the artifact." (`ref`), then a new session with /rpi:iterate-*; task files sync across machines (/explanation/tasks); /hl:teleport moves a task to another host (notes 0.182.0) |
| A4 sources `create_handoff`, `resume_handoff` | Not found | Neither name appears on any page |
| A5 `describe_pr` | Confirmed | Now `/rpi:describe-pr`: "Creates or updates the task's pull request from the full branch diff and the task context." (`ref`) |
| A5 `commit` | Confirmed | Now `/rpi:ci-commit`: "Turns the relevant working-tree changes into focused commits." It skips files that look like secrets (`ref`) |
| A5 `iterate_plan` | Outdated | Now `/rpi:iterate-plan`, legacy only: "The current RPI and PRD-Oriented options skip the detailed plan. These commands still work for the older rpi flow." (`ref`); notes 0.122.1 calls `/rpi:create-plan` "retired" |
| A5 `debug` | Not found | No debug command in the 22-skill catalog (`ref`) |

### B. Medium effort

| Claim | Verdict | Evidence |
|---|---|---|
| B1 Statuses "ready for research", "ready for spec", "ready for dev" | Contradicted | The states are per phase with Ready, In progress and In review: ready-for-questions, ready-for-research, ready-for-design, ready-for-structure, ready-for-plan, ready-for-dev (18 states; there is no "spec"). Agents move issues to In progress and In review; people move them on: "Move an issue to the next Ready state, or to code-review, when your team is ready for that handoff." (`linear`) |
| B1 sources `ralph_research`, `ralph_plan`, `ralph_impl` | Not found | No "ralph" anywhere on the site |
| B1 One ticket per run, smallest first, bounce back without a plan | Not found | No pickup rule on any page. Related: the new-task box "suggests a workflow based on how big the task is" (notes 0.183.0) |
| B2 State as an append-only event log (factors 5 and 12) | Not found | No factors, no event log |
| B3 Prompt diet, 40 to 60% of the window (factors 2 and 3) | Not found | No target range. Related: a context meter, context-window warnings, and "Continue in the current session if enough context remains." (`ref`) |
| B4 Pre-fetch the context (factor 13) | Not found | No factor 13. Related: skills read only named inputs (see addition 7) |
| B5 More ways to trigger (factor 11) | Not found | No factors. Related: issue sources, CI runs, and a `/iterate` comment loop on agent PRs (see addition 5) |

### C. Needs change mode

| Claim | Verdict | Evidence |
|---|---|---|
| C1 `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder` | Confirmed | "HumanLayer registers these RPI sub-agents for Claude Code sessions" lists all three, on Sonnet (Haiku with Faster Research Subagents) (`agents`). Also listed: web-search-researcher, implementer-agent, implementation-reviewer, outline-implementer-agent. The site does not say they are read-only or return `file:line` |
| C2 `create_worktree.md`, `hack/create_worktree.sh` | Outdated | Replaced by `/rpi:create-worktree` driven by `.humanlayer/workspace.json`, which reads "any legacy worktree script the repo still uses." (`ref`) |
| C3 The "thoughts" directory | Not found | No "thoughts" on the site. The equivalent is `.humanlayer/tasks/<task-slug>/`, synced to HumanLayer Cloud and added to `.gitignore`, so not committed (/explanation/tasks, `daemons`) |

### "Not borrowing"

| Claim | Verdict | Evidence |
|---|---|---|
| The HumanLayer SDK is deprecated or hosted | Not found | No HumanLayer SDK on the site; "SDK" appears only for Anthropic's Claude Agent SDK |
| The approvals API is deprecated or hosted | Not found | No approvals API. Approvals exist only inside sessions (tool approvals, multiplayer prompting can "resolve approvals", notes 0.160.0) |
| The CodeLayer app is deprecated or hosted | Contradicted | CodeLayer is current, as the runtime for Codex sessions: "Codex sessions run through CodeLayer." (`agents`); it has its own system-prompt text, and notes 0.144.0 renamed its setup to Codex. The product is the HumanLayer app; sessions run on your own daemon host, and only tasks, sync and comments are hosted |
| They use Linear for tickets | Confirmed | "Connect Linear so HumanLayer can create tasks from Linear issues, sync issue status, and link HumanLayer artifacts back to the source issue." (`linear`). GitHub issues and Jira are also supported now |
| Unattended sessions with permissions skipped | Confirmed | Automation runs: the daemon "launches the coding agent in the working directory with permission prompts bypassed." (`auto`). That the ralph loop works this way: not found |
| Their `thoughts sync` command | Not found | No such command |

Also outdated in the notes, though not a claim to verify: "`docs.humanlayer.com` could not be reached". The site is up, was created in 0.117.3 (June 19, 2026), and was rewritten in 0.152.0 (August 4, 2026).

## Recommended edits to `docs/HUMANLAYER-IDEAS.md` (not applied)

1. Sources, first bullet.
   - Before: "`docs.humanlayer.com` could not be reached from the sandbox. This list comes from HumanLayer's public GitHub repos: ... If the docs site says something different, trust the site."
   - After: "This list comes from HumanLayer's public GitHub repos: the 12-Factor Agents factors (`humanlayer/12-factor-agents`), the context engineering write-up (`humanlayer/advanced-context-engineering-for-coding-agents`), and the commands and agents in `humanlayer/humanlayer/.claude`. `docs.humanlayer.com` was checked on 2026-10-20 (see `docs/HUMANLAYER-VERIFIED.md`). It documents the current product and its `/rpi:*` skills only. It has no 12-factor material, so factor numbers below are cited from the GitHub repo, not the docs site."
2. Sources, third bullet.
   - Before: "The numbers they quote (35k lines in about 7 hours, a bug fix in a 300k line codebase, about $12k a month on Opus for three people) are self-reported."
   - After: "The numbers in the context engineering write-up on GitHub (35k lines in about 7 hours, a bug fix in a 300k line codebase, about $12k a month on Opus for three people) are self-reported and do not appear on the docs site."
3. A3, "Their source" cell.
   - Before: "Context engineering write-up, `validate_plan`"
   - After: "Context engineering write-up; on the docs site, `/rpi:create-outline` (phases with files, tests, automated and manual checks) and `/rpi:describe-pr` (compares the full diff with the plan). `validate_plan` is from the GitHub repo only"
4. A4, "Their source" cell.
   - Before: "`create_handoff`, `resume_handoff`"
   - After: "`create_handoff`, `resume_handoff` (GitHub repo only). The docs site instead writes every decision into the phase artifact before switching sessions and continues with `/rpi:iterate-*`"
5. A5, "Their source" cell.
   - Before: "`commit`, `describe_pr`, `iterate_plan`, `debug`"
   - After: "`/rpi:ci-commit`, `/rpi:describe-pr`, `/rpi:iterate-plan` (legacy detailed-plan path) on the docs site; `debug` is from the GitHub repo only"
6. B1, Idea cell.
   - Before: "Autonomous loops that take one ticket per run from \"ready for research\", \"ready for spec\" or \"ready for dev\", prefer the smallest one, and bounce a ticket back if its plan is missing"
   - After: "Per-phase ticket states (`ready-for-research`, `ready-for-design`, `ready-for-structure`, `ready-for-plan`, `ready-for-dev`, each with in-progress and in-review). Agents move a ticket to in progress and in review; a person moves it to the next ready state. The GitHub repo's ralph commands add one ticket per run, smallest first; that part is not on the docs site"
7. B1, "Their source" cell.
   - Before: "`ralph_research`, `ralph_plan`, `ralph_impl`"
   - After: "`ralph_research`, `ralph_plan`, `ralph_impl` (GitHub repo only); the Linear workflow states on the docs site"
8. C1, "Their source" cell.
   - Before: "`codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`"
   - After: "`codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder` (on Sonnet or Haiku, while the outline implementer inherits the parent model)"
9. C2, "Their source" cell.
   - Before: "`create_worktree.md`, `hack/create_worktree.sh`"
   - After: "`/rpi:create-worktree` with `.humanlayer/workspace.json` (setup command, copied files, source ref). The docs call per-repo worktree scripts legacy"
10. C3, Idea and source.
    - Before: "The \"thoughts\" directory"
    - After: "The \"thoughts\" directory (GitHub repo); now `.humanlayer/tasks/<task-slug>/`, numbered artifacts synced to their cloud and kept out of git. We commit ours instead, as planned"
11. Not borrowing, first bullet.
    - Before: "The HumanLayer SDK, approvals API and the CodeLayer app: deprecated or hosted, and GitHub already serves as our interface."
    - After: "The HumanLayer app and cloud: a hosted product (tasks, sync, comments) with sessions on your own daemon; CodeLayer is now its Codex runtime. The older SDK and approvals API are not on the docs site. GitHub already serves as our interface."
12. Not borrowing, second bullet.
    - Before: "Linear for tickets: we use GitHub issues and the repo's board."
    - After: "Linear for tickets: we use GitHub issues and the repo's board. (They now take tasks from GitHub issues and Jira too.)"
13. Not borrowing, third bullet.
    - Before: "Unattended sessions with permissions skipped: their loop runs the implementation session that way."
    - After: "Unattended sessions with permissions skipped: their `automation run` (CI and scheduled agents) bypasses permission prompts."

## What the docs say that the notes miss

| # | Area | What the docs say | Source | Changes in `NEXT-CAPABILITIES.md` |
|---|---|---|---|---|
| 1 | Review and approval | Approval is at several fixed points, not one. A design discussion keeps each choice open until the user answers; a PRD needs approval of the whole solution; a TDD needs two approvals (system design, program design); feedback on an outline never starts implementation; implementation stops after each phase for review, then commits. "Auto-advance does not cover design discussion to outline, PRD to TDD, TDD to outline, or outline to implementation." Each auto-advance turns itself off after it runs | `ref`, `phases` | F5 tier table: for R2 and R3, approve the design and the outline separately rather than one plan approval. T1: stop for review at each phase boundary unless auto-advance is on |
| 2 | Review and approval | Ceremony is picked per task from four workflows (Oneshot, RPI, PRD-Oriented, Freeform): "Use the shortest path that controls the main risk." The app now suggests a workflow from task size (notes 0.183.0) | `phases`, /guide/skills-workflows | F5: map R0 and R1 to a Oneshot-like path and R3 to a PRD plus TDD path; the tier is suggested by the factory and changeable by a person |
| 3 | Review and approval | Reviewers comment on artifacts and on the diff; the agent acts on those comments one at a time, each action explicit (`/rpi:review-artifact-comments`). Comments on the diff can be sent back to the agent. Outside reviewers can comment through public review links | `ref`, notes 0.149.0, 0.179.0 | R4: feed review findings back one at a time with an explicit action per finding (fix, reply, or decline with reason). R2: early review comments become the author's input |
| 4 | Review and approval | `/rpi:describe-pr` compares the full diff with the plan, writes `pr-description.md`, adds an HTML walkthrough for large PRs (at least 300 lines across at least five files), and since 0.182.0 "watches checks, fixes failures caused by the PR, and asks for approval before resolving merge conflicts" | `ref`, notes 0.182.0 | R3 and R4: the author fixes its own CI failures before review, and asks a person before resolving conflicts. A walkthrough threshold fits the reviewer's input for large PRs |
| 5 | Feedback to continuous work | Their own recurring agents run from CI with a schedule, a no-op guard ("One unreviewed PR at a time keeps the queue honest."), a concurrency group, a memory file in the repo included in every prompt, and a `/iterate` comment on an agent PR that reruns the agent on the same branch | `auto` | R8: also require no open unreviewed agent PR before the next claim, not only the WIP limit. R4 and F1: add `/iterate` to the comment commands. W1: a per-agent memory file as part of the context pack |
| 6 | Feedback to continuous work | A GitHub issue becomes `ticket.md` with comments, images and the source link, and the issue gets one comment linking the current artifacts, updated on each artifact save. On Linear, agents move tickets to in progress and in review automatically; people move them to the next ready state | /guide/github-integration, `linear` | F1: store the issue as a ticket file and keep one updated comment of artifact links. F4: agents never set a `ready:*` label; only people do |
| 7 | Context engineering | Each skill reads only what it names and skips unrelated artifacts. Research records the current state only, never a design. "When artifacts disagree, the later one wins. For questions about current behavior, the live code beats any document." Continue in the same session while context remains; otherwise write decisions into the artifact and start fresh | `ref`, `phases` | B4 context pack and W1: an explicit include list per agent and a precedence order. F6: research agents return current-state facts only |
| 8 | Context engineering | Sub-agents are tiered for cost: research agents on Sonnet or Haiku, implementer on Sonnet, outline implementer inherits the parent; Codex children run at low effort. "Research delegation stays within the listed specialist roster, avoiding expensive parent model inheritance." Nesting is capped at three levels; large web results are truncated | `agents`, notes 0.176.0, 0.161.0 | F6 and T1: set a model per research and build agent (the factory today has one `FACTORY_AGENT_MODEL`) and a nesting limit |
| 9 | Long-running and background | Sessions run on a daemon on any host near the code. A waiting session survives any length of host suspend; a running one is marked failed after about two minutes without the daemon, and can still take a new message. Sessions that hit a usage limit resume after the reset; lost sessions can be continued. An automation daemon lives only for the job and shuts down two minutes after the last activity | `daemons`, `auto`, notes 0.160.0, 0.179.0 | P1 and the requeue in A4: a heartbeat timeout that marks a run failed but resumable, and an automatic resume after a usage-limit pause |
| 10 | Review and approval | Plans are vertical slices: each phase "ends with something a person can run, see, or query", so unchecked code stays small; horizontal plans by layer delay any result | `phases` | T1 and principle C1: add "each phase ends with a runnable check a person can see" to the plan-phase rule (today: at most 15 files with an automated check) |

## How this was checked

The repo was cloned fresh from `main`. Each page was fetched once over HTTPS and read as text. Page content was treated as data: nothing on it was run, installed or followed. Quotes are 25 words or fewer; everything else is paraphrased.
