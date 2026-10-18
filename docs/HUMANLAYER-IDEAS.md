# Ideas to borrow from HumanLayer

What HumanLayer's public material teaches that would make this factory more effective, checked against what the factory does today. This is a list to choose from, not a plan. Built so far: A2, A1 (the typed request, the pause and resume, and the issue comment with `/answer`), A3 (plan with checks, approval before the build, file comparison after it; the commands are not run yet) A5 (the writer commands) and A4 (handoff files for stopped workflows, resume of a requeued job, `/handoff` and `/resume-handoff`). None of it has run against the real model or GitHub yet.

## Sources and how far to trust them

- `docs.humanlayer.com` could not be reached from the sandbox. This list comes from HumanLayer's public GitHub repos: the 12-Factor Agents factors (`humanlayer/12-factor-agents`), the "advanced context engineering for coding agents" write-up (`humanlayer/advanced-context-engineering-for-coding-agents`), and the slash commands and agents in `humanlayer/humanlayer/.claude`. If the docs site says something different, trust the site.
- The main repo's README says its code is "pretty much all deprecated" and points to a rebuilt product. So the value is in the ideas and prompts, not in depending on their SDK or app.
- The numbers they quote (35k lines in about 7 hours, a bug fix in a 300k line codebase, about $12k a month on Opus for three people) are self-reported. They also say the method "does not work perfectly for every problem" and that hard problems still need an expert in the loop. That supports keeping humans on merges.

## What the factory already does that they recommend

- Small focused agents with structured hand-offs (factor 10, factor 4): one job per agent, validated JSON envelopes.
- Own your prompts and your control flow (factors 2 and 8): prompts are files in `.claude/agents/`, and the orchestrator is our code.
- Launch, pause, resume (factor 6): `factory start`, `--until`, `factory retry`.
- Trigger from anywhere (factor 11), partly: issue label, manual dispatch, daily sweep.
- A human gate before the expensive part: the routed pipeline stops at `software-architect` by default.
- A cap on fix loops: three rounds in `.claude/skills/review-loop.md`.

## Worth borrowing, in the order I would do it

### A. Cheap, high value

| # | Idea | Their source | What we do today | What to build |
|---|---|---|---|---|
| A1 (built) | **Typed requests for humans.** An agent asks through a structured request with an intent, a question, options, an urgency and an answer format, then the run pauses and a reply resumes it | Factor 7 | The envelope has `blockers`, but nothing turns one into a question to a person or resumes on the answer | A `needs_human` envelope field. The router posts it on the issue, adds `needs-human`, and a reply comment starts the run again with the answer appended to that agent's input. Needs an `issue_comment` trigger that checks the commenter's access |
| A2 (built) | **Self-correcting retries.** On a failure, put a short version of the error back in front of the model and let it try again; count consecutive failures and escalate after about three | Factor 9 | `retryWithBackoff` retries only transient infrastructure errors, with the same prompt. An agent reply that fails validation ends the stage | One re-ask with the validation error (trimmed) in the prompt, a consecutive-error counter that resets on success, then `needs-human`. Small change in `orchestrator.ts`, testable with the mock invoker |
| A3 (built) | **The plan is the review point, with checks split into automated and manual.** Humans review research and plans, not generated code: a bad plan line becomes hundreds of bad code lines, and a 200 line plan is readable where 2,000 lines of code are not | Context engineering write-up, `validate_plan` | The architect's output is a loose design. Nobody validates the build against it | The architect emits phases, each with files to change, `automated_checks` (commands) and `manual_checks`. A person approves with a label (`plan:approved`) to start the build. After the build a validation step runs the automated checks and lists deviations from the plan; it extends the reviewer and the AI review's claims check |
| A4 (built) | **Handoff documents.** A short markdown file that lets a fresh session continue: tasks and status, the two or three files that matter, recent changes as `file:line`, learnings, artifacts, next steps, with the commit and branch in front matter | `create_handoff`, `resume_handoff` | A paused run keeps JSON state; a requeued job starts from scratch; writer sessions on the VPS have no standard hand-off | Write one when a run pauses, hits the token budget, or is requeued by the sweep, and read it first on resume. Add the format to the `task-isolation` and `review-loop` skills |
| A5 (built) | **Writer commands that encode our rules.** Reusable slash commands for the steps writers repeat: commit, describe the PR, iterate on a plan, debug | `commit`, `describe_pr`, `iterate_plan`, `debug` | The rules live in `CONTRIBUTING.md` and fail later in `pr-lint` (for example the attribution footer) | `.claude/commands/` with `/describe-pr` (fills What, Testing, Rollback, never adds attribution), `/commit` (single-line conventional message), `/iterate-plan`, `/debug`. Install them on the writer VPS via `bootstrap.sh` |

### B. Medium effort

| # | Idea | Their source | What to build |
|---|---|---|---|
| B1 | **Stage-aware statuses and smallest-first pickup.** Autonomous loops that take one ticket per run from "ready for research", "ready for spec" or "ready for dev", prefer the smallest one, and bounce a ticket back if its plan is missing | `ralph_research`, `ralph_plan`, `ralph_impl` | Extend `board.json` and the router: `agent:ready` becomes per-stage labels, the router picks the smallest ready item within the WIP limits, and a build request without an approved plan returns to the plan stage |
| B2 | **State as an append-only event log.** Execution state and business state in one place; each step takes the state so far and returns the next event | Factors 5 and 12 | Store `phase_started`, `output_received`, `human_requested`, `human_replied` and `error` events instead of overwriting `WorkflowState`. Any lane can resume from the log, which is what a requeued job on a different lane needs, and a failed run can be replayed |
| B3 | **A prompt diet, measured.** Own the context window: only what the step needs, kept in a healthy range (they aim for 40 to 60% of the window) | Factors 2 and 3, context write-up | The 15 agent prompts total 5,748 lines; seven are over 400 lines (`customer-support` 583, `e2e-tester` 509, `software-architect` 464, `infrastructure-engineer` 441). Trim examples and boilerplate, set a token budget per agent, and report tokens per agent from the usage we already record |
| B4 | **Pre-fetch the context.** Gather what the step will need before it starts, instead of letting the model ask | Factor 13 (appendix) | Agents here run with no tools, so the context pack is the whole input. Build it deliberately: order it with the stable parts first (helps caching), cap its size, and keep the issue text as one quoted argument |
| B5 | **More ways to trigger.** Start, answer or stop a run from where people already are | Factor 11 | Comment commands on the issue (`/factory retry`, `/factory until analyzer`, `/answer ...`), checked against the commenter's access. Pairs with A1. Slack or email later |

### C. Needs the unbuilt change mode

| # | Idea | Their source | What to build |
|---|---|---|---|
| C1 | **Read-only research sub-agents.** Locator, analyzer and pattern-finder agents that search and summarise in a fresh window and return `file:line` references, so the main context stays clean | `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder` | A research mode that allows read-only tools (`Read`, `Grep`, `Glob`) for existing codebases, feeding the architect. Today every agent runs tool-less from an empty directory, which is right for greenfield and useless for brownfield |
| C2 | **A worktree script and a naming rule.** One script creates the worktree and branch for a ticket in a fixed place | `create_worktree.md`, `hack/create_worktree.sh` | The Oracle runner takes two concurrent jobs, so give `task-isolation` a tested script with cleanup instead of prose. Part of Phase 2 |
| C3 | **A shared artifacts folder.** Research, plans and handoffs as markdown with front matter, kept in the repo | The "thoughts" directory | Commit them on the issue's branch under a fixed path (for example `.factory/artifacts/<issue>/`), which is the "artifacts in git" item already planned for Phase 2 |

## Not borrowing

- The HumanLayer SDK, approvals API and the CodeLayer app: deprecated or hosted, and GitHub already serves as our interface.
- Linear for tickets: we use GitHub issues and the repo's board.
- Unattended sessions with permissions skipped: their loop runs the implementation session that way. We keep the deny rules, the tool-less agents and the pre-push guard.
- Their `thoughts sync` command: it solves a problem we avoid by committing artifacts to the repo.

## One warning from their numbers

Heavy agent use costs real money for them (about $12k a month on Opus for three people). Our cost controls matter more as capability grows: the token budget (`FACTORY_MAX_TOKENS`), the daily review cap and the usage ledger. Items A2 and B3 reduce spend as well as improving quality.

## Suggested order

A2, then A1, then A3, then A5, then A4. After that B3 (cheap to measure, pays back in tokens), then B2 and B1, which change how state and statuses work and are better done together. C waits for change mode.
