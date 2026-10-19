# Next capabilities

What to build next, in order, and how we will know each piece works. It combines two reassessments: the review process (is independent review part of the autonomous cycle?) and the development flow (is the factory agile, with feedback from users driving continuous work?). Both answers were "partly, and not yet running". The ideas in `docs/HUMANLAYER-IDEAS.md` that are still open are placed inside this plan; the ones already built are listed at the end.

## Where we stand

**Working practices are agile.** Trunk-based flow, small merge-commit PRs, WIP limits (1 in progress, 2 in review), issues as the source of truth, resumable and handed-off runs, a mission with behaviour changes and signals.

**The product pipeline is waterfall-shaped.** One brief runs a fixed chain (`.factory/pipeline.ts`): requirements, analysis, architecture, build, test, e2e, review, docs, each handing the next a finished document, with a plan-approval gate before every build whatever its size. Specifically missing:

- **Change mode.** The factory cannot modify existing code (README, Status). After a first build, feedback has nowhere to go. This is the largest gap.
- **Feedback in.** Nothing takes user feedback in, triages it, or ranks it.
- **Signals.** Nothing records a baseline for a behaviour change's `Signal` or reads it after release.
- **Increments.** There is no smallest-change run; every run re-derives requirements and architecture.

**Review is not yet an independent step in the cycle.**

| Step of the intended cycle | State |
|---|---|
| Author opens a draft PR | Drafts count as "In progress" on the board; no code opens one, and the pipeline's `createPR` is not a draft |
| Independent agent reviews the draft | Not supported: `templates/ai-review/ai-review.yml` skips drafts, and is not installed in this repo |
| Author reads feedback and fixes | Guidance only (`.claude/skills/review-loop.md`, 3 rounds); no code drives the loop |
| Author marks the PR ready | Not built |
| Final review approves | Runs when installed; shadow mode only comments and labels risk. `ai-review:*` labels are written and read by nothing, and the policy engine ignores them (only `blocked` adds `policy:manual`) |
| Merge | `policy.json` decides auto or human. By default a change that touches nothing protected merges itself after CI and the reviewer verdict; a person is asked, with the question on the PR and the `needs-human` label, only when the policy or the review cycle needs one. Only the pipeline's end-of-run step merges; no workflow merges after an approval |
| Work continues | The router starts only on the `agent:ready` label; nothing runs after a merge |

No PR in this repo so far has had an independent agent review. Review has been CI plus a person's merge.

## The flow we are building

```
users ─▶ FEEDBACK  issue form, support, release comments, usage numbers (raw text kept as data)
  ▼
TRIAGE   bug | request | question; which BCn or goal it touches, or out of mission; severity; duplicates
  ▼
DECIDE   rank by (signal gap x severity) / size; smallest first; a person approves what enters WIP
  ▼
SLICE    one PR-sized increment: Serves: line, acceptance check, size and risk tier
  ▼
BUILD    change mode, short path (plan the delta, build, test) as a DRAFT PR
  ▼
EARLY REVIEW   independent agent, advisory, comments on the draft
  ▼
FIX      author addresses findings, at most 3 rounds, stale-SHA check ─▶ cap: needs-human
  ▼
READY    author marks the PR ready
  ▼
FINAL REVIEW   independent agent, enforced; result file with head_sha and status
  ▼
POLICY   reads CI + review result + risk tier ─▶ R0/R1 auto, R2/R3 and policy:manual wait for a person
  ▼
MERGE    deterministic merge worker (never the author), merge commit, pinned to the reviewed SHA
  ▼
RELEASE  small and often
  ▼
MEASURE  read the Signal against its baseline; tell users what changed and ask again
  ▼
LEARN    keep, iterate or revert; propose a mission change as a PR; back to FEEDBACK
```

**Ceremony scales with the slice.** The existing risk tiers decide what applies:

| Tier | Example | Plan approval | Requirements and architecture documents | Review | Merge |
|---|---|---|---|---|---|
| R0 | docs, typo | no | no | light | auto |
| R1 | small fix, one behaviour | no (a delta plan is still written) | no, uses the living design | yes | auto after review |
| R2 | new feature part | yes | delta only | yes | auto after review, unless it touches protected paths |
| R3 | security, money, data, workflows | yes | full | yes, extra lens | person (these are protected paths) |

## Capabilities

Sizes are relative (S, M, L), not time. "Done when" is the check that it works, with evidence, not a claim.

### M0. Prove it runs (needs the owner's accounts and secrets)

| ID | What | Done when |
|---|---|---|
| P1 | First real hosted-lane run: create the `agent:ready` label, add a Claude token secret, label one small issue | The router claims it, a pipeline job runs to its `until:` stop, and the issue gets the result comment. Every bug found is fixed with a test (the ts-node `board.json` bug showed unit tests miss these) |
| P2 | Install the AI review in shadow mode on this repo | One real PR gets a review comment and a result file; false-positive rate and cost per review are recorded (this is R1) |
| P3 | Use the writer commands in a live session (`/commit`, `/describe-pr`, `/mission`, `/lookfeel`, `/handoff`) | The tool-permission patterns are confirmed or fixed |

### M1. Review loop closed

| ID | What | Depends | Size | Done when |
|---|---|---|---|---|
| R1 | Install and harden the AI review: create the `risk:*` and `ai-review:*` labels, wire the monthly budget, verify the `--json-schema` output | P2 | S | Shadow run is clean on 5 PRs |
| R2 | Early review on drafts: advisory, comment only, opt-in label (`review:early`), one per push, capped per day | R1 | S | A draft with the label gets one comment per push, never a verdict label |
| R3 | Draft-first authoring: the pipeline and the writer commands open drafts; a `markReady` helper (GraphQL `markPullRequestReadyForReview`) | none | S | A pipeline run ends with a draft PR; ready is a separate, logged step |
| R4 | Review-loop driver: when the review of the current head has findings, the author job runs again with them (max 3 rounds, stale-SHA check, cap goes to `needs-human`, tokens counted in the ledger) | R1, R3 | M | A seeded flaw is found, fixed in a round, and the next review is clean |
| R5 | Policy reads the review: a new `ai_review` require item. Passes only when status is `complete`, `head_sha` equals the PR head, verdict is `approve`, no open blocker or major finding, tier R0 or R1, and CI is green | R1 | M | Unit tests for every refusal; a stale or degraded review never passes |
| R6 | Merge worker: a deterministic workflow merges `policy:auto` PRs that pass R5 (the independent AI review) and CI, with a merge commit and `expectedHeadSha`; kill switch; never merges protected paths or its own change; when it cannot merge it asks a person with the question on the PR | R5 | M | One R0 PR and one R2 PR merge with no person; a PR touching a protected path does not, and the person is asked |
| R7 | Independence and evaluation: the reviewer runs in a separate session and account setting from the author, sees the diff and the PR text as claims only, never the author's reasoning; a seeded-flaw evaluation (planted bugs) decides when to switch from shadow to enforce | R1 | M | A seeded-flaw run shows which planted bugs it found and missed, and a person has read each miss and each false alarm before enforce mode is turned on |

### M2. Feedback in

| ID | What | Depends | Size | Done when |
|---|---|---|---|---|
| F1 | Feedback intake: an issue form (what happened, expected, where, how bad), `type:feedback` and `source:*` labels, the raw text stored as quoted data and never executed, duplicate detection, rate limit per author. Comment commands (idea B5) for `/factory retry`, `until`, `/answer` sit here | none | S | A form submission becomes an issue with the right labels; a duplicate is linked, not repeated |
| F2 | Triage: a `/triage` command and a short-lane job that classifies, links a behaviour change or goal (or flags out of mission), suggests a `Serves:` line and a severity. It comments and labels; it never closes an issue | F1 | M | A person reads the suggested link and severity on a batch of real reports and records where they disagree and why; those disagreements, not a pass rate, decide whether it is trusted |
| F3 | Signals: a baseline and a latest reading per behaviour change, kept in the project (`signals` log), entered by hand at first with `/signal`, then read from a source the owner names | decision below | M | Every behaviour change has a baseline and a dated reading; release notes quote them |

### M3. Decide and slice

| ID | What | Depends | Size | Done when |
|---|---|---|---|---|
| F4 | Decide and pick up (idea B1): stage-aware labels (`ready:spec`, `ready:build`), smallest-first within WIP, priority `(signal gap x severity) / size`, a person approves what enters WIP, a build without an approved plan bounces back, and `type:feature` and `type:future` labels with a rule that a future item is offered next whenever the last three merged items were features | F2, F3 | M | With five ready issues the router offers the smallest valuable one that fits the limits, and after three feature merges it offers a future item first |
| F5 | Increment mode: a pipeline kind that skips the product-manager and full architecture when a living design exists in the repo, plans only the delta, and applies the tier table above (plan approval only for R2 and R3) | F6 | L | An R1 increment is built from the living design with no product-manager or full architecture phase and needs no plan approval; cost is reported by `npm run report:usage` as a limit, and a person judges whether the plan and PR were easier to review than a full run's |
| R8 | After a merge, the router picks the next ready item (closes the continuous loop); a person decides what is ready by labelling it, and the factory does it | F4, R6 | S | A merge is followed by the next claim with no person involved, inside WIP |

### M4. Change mode

| ID | What | Depends | Size | Done when |
|---|---|---|---|---|
| F6 | Change mode (ideas C1 to C3): read-only research agents that return `file:line` references, a tested worktree script, an artifacts folder per issue, builders that output a patch applied in a worktree and committed, tests run in CI on the result | R3 | L | A feedback fix changes existing code in a worktree, CI runs its tests, review and merge follow the loop |

### M5. Release and learn

| ID | What | Depends | Size | Done when |
|---|---|---|---|---|
| F7 | Release cadence for built apps: small frequent releases (`.claude/skills/release-process.md`), flags for risky slices, release notes generated from merged issues that say what users can try and invite feedback (which feeds F1) | F6 | M | A release produces notes and a feedback link |
| F8 | Learn: after a set time, compare each behaviour change's signal with its baseline and record keep, iterate or revert; propose a change to `MISSION.md` as a PR for a person | F3, F7 | M | A release has a recorded verdict per behaviour change |

### Knowledge and character follow-ups

Built so far: `CHARACTER.md`, the project wiki and the project `CLAUDE.md` (see `docs/ORCHESTRATION.md`). They are written and checked by people and interactive sessions. These make the pipeline use them.

| # | Capability | Depends on | Size | Done when |
|---|---|---|---|---|
| W1 | Hand the character to the product manager and architect, and wiki pages to every planning agent: the index always, the pages whose title or sources match the brief, inside the context pack's budget and never over it | none | M | A run on a project with a wiki shows the matching pages in the architect's input, and `npm run report:usage` shows the cost |
| W2 | The docs stage proposes wiki updates (a decision record for each decision in the plan, a changed page when a source path changed) as files in the PR, always as drafts for a person | W1 | M | A pipeline run on a project with a wiki adds or updates at least one page, and `wiki:check` passes on the PR |
| G1 | Alignment stage: before the architect, an agent questions a person about the design (users, flows, failures, boundaries, words, assumed changes) with its own question limit, then returns a one-page design concept a person confirms; decisions and the dialogue land in the wiki as drafts | W1 | M, first | A run on a vague brief asks questions, ends with a confirmed concept, and the architect's plan cites it |
| T1 | Builders that run in a loop: in a worktree with tools, write a failing test, make it pass, run typecheck and tests after each step, stop at the plan's phase boundary | built with F6 | L | A phase is built in several small commits, each with a passing check, and the PR shows the test runs |
| W3 | Run `wiki:check`, `wiki -- drift` and `claudemd:check` in CI for projects that have them, and open an issue (as the weekly full run does) when drift passes a threshold | none | S | A stale page fails nothing but opens one issue; a broken link or a secret fails the PR |

### Low-cost additions from HumanLayer's docs

Checked against docs.humanlayer.com in October 2026. Each one is a prompt, config or small router change that makes a larger capability above cheaper or safer. They are chosen for value without much new machinery; what was left out is listed below the table.

| # | Capability | Depends on | Size | Done when |
|---|---|---|---|---|
| H1 | One open agent PR at a time, and `/iterate`: the router claims nothing while an agent PR is still unreviewed (on top of the WIP limits), and a `/iterate <feedback>` comment on an agent PR from someone with write access runs the author again on the same branch with the PR discussion and the feedback. This is the manual form of R4 and the guard R8 needs | P1 | S | With an unreviewed agent PR open, a ready issue is not claimed; a `/iterate` comment from a writer updates the same branch, and one from anyone else is ignored |
| H2 | Every plan phase ends with something a person can run, see or query (a command, a page, a query), not only an automated check. Architect prompt and plan check; layer-by-layer plans are flagged | none | S | A plan with a phase that has no runnable check is flagged to the approver, with a unit test |
| H3 | Ceremony set by size: the factory suggests the risk tier with its reason as a label, and a person can change it. R0 and R1 need no approval; R2 and R3 get two short approvals, the design (the G1 concept) and the outline (the plan), instead of one large one | G1, part of F5 | S | An issue gets a suggested tier with a reason; changing the label changes which approvals the run asks for |
| H4 | The context pack lists its inputs per agent and a precedence order: each agent gets only the inputs named in its contract; when documents disagree the later one wins (plan over design over requirements over issue); for how things work today, the live code beats any document | none | S | A unit test shows each agent's pack holds only its listed inputs, and every agent prompt states the precedence order |
| H5 | A model per agent: `FACTORY_AGENT_MODEL` stays the default, and an agent can name its own (cheaper for research and review, the strongest for builders) | none | S | A per-agent setting overrides the default in a unit test, and `npm run report:usage` shows the model for each phase |
| H6 | Lessons that build up: a lessons page in the project wiki, always included in the context pack within its budget, changed only by PR when a run teaches something. Part of W1, not a second store | W1 | S | A run on a project with a lessons page shows it in each agent's input; a lesson added by PR appears in the next run |

T1's first version stays small: one builder in a worktree, typecheck and tests after each phase, on a change the size of an R1 slice. Research sub-agents (C1) and more than one repository come after it works.

Not taken from HumanLayer, because they add machinery without enough return here: their 18 Linear workflow states, Slack automations, multiplayer prompting, cloud-synced task folders (we commit artifacts), and a separate PRD and TDD stage for every change (R3 only, if ever).

## Principles check

The five principles in `.claude/skills/principles.md` were checked against the factory. These are the places where it contradicts them, what was changed already, and what needs the owner's decision. Nothing marked "decision" has been changed.

| # | Principle | What the factory does | Done in this change | Decision or capability |
|---|---|---|---|---|
| C1 | 4 small testable steps, test first, runtime feedback; 2 code is not cheap | Agents run with `claude -p` and no tools. Each builder returns all its files in one reply. Tests are written after the build by another agent. Nothing runs a test, a typecheck or a browser before review, and the reviewer cannot run commands | Plan phases are at most 15 files with an automated check each; each module has boundary tests; a step with no test file is flagged to the approver; builder prompts say tests come with the code | **Decided:** F6 with T1 is the next large capability, after G1. Until then this principle is only partly met |
| C2 | 1 people stay strategic directors; approval at critical actions | Docs-only and `fix/*` PRs can merge themselves (the fix rule relies on a reviewer agent's verdict). Plan approval is off unless `FACTORY_PLAN_APPROVAL=1`. R6 (merge worker) and R8 (continue after merge, no person involved) are planned | The reviewer must now show what it tried to break. The plan shows assumed changes to the approver | **Decided, then revised by the owner:** (a) plan approval is on by default (`FACTORY_PLAN_APPROVAL=0` skips it; the exemption for tiers R0 and R1 arrives with the tier table); (b) the owner reversed the first call on merging: agents merge after the review cycle by default, and a person is asked only when absolutely needed (a protected path, `needs-human`, the reviewer did not approve, CI not green, the merge failed), with the question highlighted on the PR; (c) R6 and R8 return to their original form. The risk the principle names stays: until the independent AI review (R1 to R5, R7) exists, the review cycle is the same factory's reviewer agent plus CI, so protected paths are the real guard |
| C3 | 2 and 4: spec-driven fantasy; learning over one-shot specifications | The pipeline turns a brief into a whole app in one pass (the factory's own description says "production-ready code"). Change mode does not exist, so existing code would be regenerated, not changed | `/grill` before planning; plan approval; small phases; futures listed | **Decided:** G1 first, then F6 with T1, then F5 before any whole-app work; the factory is described as producing reviewed increments, not production-ready code |
| C4 | 5 do not over-index on what is easy to count | CI fails below the Jest coverage threshold and the full-run check wants 70% statements. The tester prompt used 70% as a target. Several "done when" lines in this document count tokens, runs or reviews | The tester prompt now calls 70% a floor and an alarm; the reviewer is told never to treat volume, tokens or coverage as evidence of value; the mission check warns on signals that count our own output | **Decided:** coverage stays a floor in CI and in the tester prompt, never a target; the token-based and pass-rate "done when" lines (R7, F2, F5) are replaced by a person's reading of the evidence, with cost kept as a limit |
| C5 | 2 features and futures | The router's planned priority is `(signal gap x severity) / size`, smallest first. That favours features; nothing reserves time for refactoring | Plans list `futures`; the approver sees them | **Decided (F4):** `type:feature` and `type:future` labels; a future item is offered next whenever the last three merged items were features |
| C6 | 4 tight feedback loops | PRs now run only the tests their change needs and the full suite runs weekly (a choice made earlier). A break the selector misses can live for up to a week | None | Minor. Run the full suite nightly while a project is young, weekly once it is calm. The owner's earlier choice stands until told otherwise |
| C7 | 1 care in every layer | Only prompts ask for it (errors, logs, migrations, comments that say why) | Builder and reviewer prompts | A prompt cannot guarantee it. A reviewer who lists unseen layers it checked is the nearest check; a person still has to look |

## Order

Set by the owner after the principles check (C1, C3):

```
M0 prove it runs ─▶ H2, H4, H5 ─▶ H1 ─▶ G1 alignment stage ─▶ F6 + T1 change mode with a build loop ─▶ F5 increment mode (with H3)
                 └▶ M1 review loop (R1 to R5, R7; R6 for docs only) ─▶ M2 feedback in ─▶ F4 ─▶ R8 ─▶ M5 release and learn
```

H2, H4 and H5 are prompt and config changes, so they come right after M0; H1 then gives a working review cycle before R4 exists. H6 lands with W1. The WIP limit applies: one at a time unless the owner says otherwise. F5 now depends on F6 and a living design in the repository, not on F4. M0 comes first because nothing after it has run against real services, and the first real run is the cheapest way to find the bugs that tests cannot.

## Decisions needed from the owner

Settled by the owner after the principles check: C1 to C5 (see the table above). Still open: C6 (run the full suite nightly while a project is young) and the four below.

1. **Early review on drafts (R2):** advisory and opt-in is recommended; a review on every push costs money.
2. **Merge worker rights (R6):** settled by the owner: agents merge after the review cycle by default and a person only when absolutely needed. It needs a token with merge rights, and branch protection is not available on the free plan, so the workflow, the protected paths and the kill switch are the control.
3. **Where signals come from (F3):** analytics, support tickets, app-store reviews or something else decides how F3 is read.
4. **Who answers feedback to users:** a person, or an agent drafting replies for a person to send.

## Principles

- Small, frequent, reversible. Every capability above reverts with one merge commit.
- Review is independent of the author: a separate session, claims not reasoning, evidence quotes or silence.
- A person decides direction (mission, ranking, R2 and R3 merges); agents do the work and the checks.
- Ceremony follows size and risk, not habit.
- Nothing is called done without a run against the real thing and a recorded result. Unverified items stay listed as unverified.

## Already built (from `docs/HUMANLAYER-IDEAS.md`)

A1 typed questions and `/answer`, A2 self-correcting retries, A3 plan with checks and approval, A4 handoff files and requeue resume, A5 writer commands, B2 event log, B3 prompt budgets, B4 context pack; plus the mission (with goals), the router's `Serves:` check, and the look and feel step. Still open from that list and placed above: B1 (F4), B5 (F1), C1 to C3 (F6).
