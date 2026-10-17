# Cloud Runners: Actions, Buddy.works and Oracle Cloud

Goal: run agents on three free pools, short jobs on GitHub Actions, long jobs on an Oracle Cloud VM, overflow on Buddy.works, with GitHub itself as the orchestrator and the only source of truth. This is the plan; nothing here is built yet.

## 1. What each pool really gives

Facts come from search results, not from the vendors' own pages (the sandbox could not reach them). Re-check before relying on any number.

| Pool | Free allowance | Limits that shape the design | Confidence |
|---|---|---|---|
| GitHub Actions (hosted) | 2,000 Linux minutes a month on private repos, 500 MB artifacts; self-hosted runners are not billed | Jobs round up per run, hosted jobs stop at 6 hours, a cron poll burns minutes | Medium (third-party sites; GitHub's page says it depends on the plan) |
| Oracle Cloud Always Free | Ampere A1: reported **cut on 15 June 2026 from 4 OCPU / 24 GB to 2 OCPU / 12 GB**, no Oracle announcement; free instances above the new limit were due to be terminated from 18 August 2026 | Idle reclamation (about 20% CPU, network and, on A1, memory over 7 days), "out of capacity" errors at creation, no SLA, no support | Medium (press: InfoQ, heise; Oracle's docs conflict) |
| Buddy.works Free | 300 pipeline GB-minutes a month, 1 user, 1 runner, 1 concurrent pipeline; workspace frozen after 60 days idle | GB-minutes depend on runner size, so wall-clock time is unknown (likely 1 to 2 hours); max run time not found | Low |

Consequences: plan for **2 OCPU / 12 GB** on Oracle (two concurrent agent sessions at most), treat Buddy as a bonus lane the system works without, and spend Actions minutes only on short, deterministic or single-call jobs.

## 2. Architecture

```
GitHub = control plane (issues, labels, PRs, board view, Actions queue)
   │  event: issue labelled agent:ready · PR opened/updated · workflow_dispatch
   ▼
route (ubuntu-latest, about 20 s, no model)
   │  reads labels + budget ledger → picks a lane
   ├─ lane:short ─▶ job on ubuntu-latest        review, Gate A, triage, small fixes      [2,000 min pool]
   ├─ lane:long  ─▶ job on [self-hosted, oracle]  full pipeline, refactors, long loops   [no minutes]
   └─ lane:burst ─▶ curl Buddy webhook            overflow when Oracle is busy or down    [300 GB-min pool]
   ▼
every lane reports back the same way: labels, comments, branch, PR  →  GitHub
```

**The key choice: the Oracle VM is registered as a self-hosted Actions runner.** Jobs reach it through GitHub's own queue, so no inbound port is open, no custom polling loop or claim protocol is needed, and `concurrency:` groups give mutual exclusion per issue. Logs, retries and cancellation come free. Buddy is reached by one outbound webhook call from a short Actions step. Buddy and Oracle never talk to each other; both talk only to GitHub.

### State machine (labels on the issue, mirrored to the board)

```
agent:ready ─▶ agent:working ─▶ agent:review ─▶ done
                   │                 │
                   ├─ agent:failed   └─ needs-human
                   └─ lease expired ─▶ back to agent:ready (once), then needs-human
```

- **Claim:** the job that starts adds `agent:working` and a heartbeat comment; the `concurrency` group `agent-issue-<n>` stops a second job for the same issue.
- **Lease:** the job edits its heartbeat comment every 10 minutes. `route` treats a heartbeat older than 30 minutes as dead. A daily scheduled run (about 30 minutes a month) sweeps for these.
- **Board:** the GitHub Project is a view over these labels (`board-sync.yml` already mirrors the template). A user-level Project needs a PAT, so the labels stay the source of truth.
- **Limits:** WIP limits from `.factory/board.json` apply before `route` starts any job.

### Routing rules (deterministic, in code, no model)

| Signal | Lane |
|---|---|
| Review, Gate A, triage, label or comment work, estimated under 10 minutes | short |
| Full pipeline, multi-stage, refactor, estimate over 10 minutes, or `lane:long` label | long |
| long requested and the Oracle runner is offline or busy for over 15 minutes, and Buddy has budget | burst |
| Actions pool over 80% used this month | move short jobs to long |
| Nothing available | leave `agent:ready`, comment why |

Budget ledger: every job appends `lane, seconds` to a pinned ledger issue. `route` reads it before choosing. Platform dashboards stay the real meter; the ledger is a guard.

## 3. Security rules

- Only repo collaborators with write access can start agent work: `route` checks the permission of `github.event.sender` before it does anything.
- Issue titles and bodies are untrusted: they reach scripts through environment variables and files, never inside `run:` text.
- The Oracle runner takes jobs only from workflows on the base branch triggered by labels, `workflow_dispatch` or schedule. Never `pull_request_target` or PR code on it. Private repo only.
- Each lane has its own credentials: a fine-grained GitHub token per lane (contents, pull requests, issues; no admin), the writer's Claude account token on Oracle (see HYBRID-PIPELINE section 6a), `CLAUDE_OAUTH_<LOGIN>` secrets on Actions, a Buddy-only token on Buddy.
- Merging stays with the policy engine. Tokens cannot be scoped to "write but not merge", so the pre-push guard, the `gh pr merge` deny rule and `policy.json` remain the controls.
- Kill switch: repository variable `AGENTS_ENABLED=false` stops `route`.
- The Oracle VM is disposable: `templates/workspace/bootstrap.sh` rebuilds it; no state lives only there.

## 4. What to build (one PR each)

Built so far: slice 0 (the vulnerable workflow removed), slice 1 (`.factory/route/`) and slice 2 (the workflows below). The router is pure code with no network calls: `route(input)` returns `start` (with the lane, the concurrency group `agent-issue-<n>`, and the labels to add and remove), `wait` or `ignore`, each with reasons. Defaults live in `DEFAULT_BUDGET` (2,000 hosted minutes with a soft limit at 80%, Buddy off, 15 minute Oracle grace period). Unlabelled work defaults to the long lane so it costs no hosted minutes, and an unreadable ledger is treated as a used-up hosted pool.

| # | Slice | Notes |
|---|---|---|
| 0 | Remove the injection in `factory-start.yml` | It interpolates the issue title into a shell script. The workflow cannot run today (no `claude`), so replace it with `route` below rather than patch it |
| 1 | `.factory/route/`: lane selection, lease check, ledger, with tests | Pure functions, GitHub calls injected |
| 2 | `route.yml` and a reusable `agent-job.yml` (`workflow_call`, `runs-on` as input) | Runs `factory start --until <agent>` first; code-landing needs Phase 2 (worktree, commit, draft PR), still unbuilt |
| 3 | Oracle runner bootstrap: runner install, systemd unit, doctor checks | Extends `templates/workspace/` |
| 4 | Buddy pipeline template and the webhook step | After a Buddy account is checked |
| 5 | Ledger guard and the daily lease sweep | |

Slice 2 depends on Phase 2: until agents can commit into a worktree and open a draft PR, a long job can run stages and post their artifacts on the issue but cannot deliver code.

### Slice 2: how the pieces are wired

| File | Job |
|---|---|
| `.github/workflows/route.yml` | On label `agent:ready` (or manual dispatch) runs `route-cli decide`: checks the sender, the issue state, WIP, the ledger and the Oracle heartbeat, then claims the issue (labels and a lease comment) and calls `agent-job.yml` |
| `.github/workflows/agent-job.yml` | Two jobs so the Oracle job never references a secret: `hosted` (short lane, `ubuntu-latest`, gets Claude credentials) and `oracle` (long lane, `[self-hosted, oracle]`, uses the writer's local login) |
| `.github/actions/agent-run/` | Shared steps: install, run `factory start <issue brief> --until <agent>` with a 10 minute lease heartbeat, hand the issue back (`agent:review` or `agent:failed`), charge the ledger, keep the workflow state as an artifact |
| `.factory/route/cli.ts` | `decide`, `beat` and `finish` subcommands over the pure router and a thin `gh` wrapper |

Behaviour to know:
- The pipeline stops at the agent named by an `until:<agent>` label, default `software-architect`. It writes artifacts, not code, until Phase 2 exists.
- The Oracle VM proves it is alive by setting the repository variable `ORACLE_LAST_SEEN` (UTC time) every few minutes (slice 3 adds the timer). No heartbeat means the long lane waits.
- The ledger is an open issue labelled `agent:ledger`, created on first use. Each routed run costs one hosted minute for the router plus the job time.
- The pipeline step gets no `GITHUB_TOKEN`, so the orchestrator cannot open or merge PRs from a routed run.
- The hosted lane picks one credential: the issue author's account (`REVIEW_ACCOUNT_MAP`), a shared `CLAUDE_CODE_OAUTH_TOKEN`, then `ANTHROPIC_API_KEY`.

To try it: create the label `agent:ready`, open an issue, label it with `agent:ready` and `task:review`, and watch the Actions tab. For the long lane, slice 3 must be done first.

## 5. Decisions (settled)

1. **Oracle sized at 2 OCPU / 12 GB** for now. Two concurrent agent sessions at most; raise it only if the console shows more.
2. **Self-hosted runner approach.** The Oracle VM is a self-hosted Actions runner; no custom polling worker.
3. **Buddy is a bonus lane only.** Nothing depends on it until its real wall-clock allowance is measured.

## 6. Not verified

- Every free-tier number above (see the table).
- The longest job a self-hosted runner may run (believed to be days, not hours; check).
- That `runs-on: [self-hosted, oracle]` queues cleanly when the runner is offline (jobs wait, then time out).
- Buddy's webhook response shape and maximum run time.
- Cost and token use of long agent jobs on a personal Claude plan.
- Slice 2 has never run in Actions. In particular: that a reusable workflow with `secrets: inherit` hands secrets only to the job that references them (the Oracle job references none), that `secrets[fromJSON(...)[inputs.author]]` resolves to empty for an unmapped login, and that a background heartbeat in a composite action survives until the step ends.
