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
                   ├─ agent asked a question ─▶ needs-human ─ /answer ─▶ agent:ready
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

Built so far: slice 0 (the vulnerable workflow removed), slice 1 (`.factory/route/`), slice 2 (the workflows below), slice 3 (the Oracle runner scripts), slice 4 (the Buddy burst lane) and slice 5 (the daily sweep). All slices are now written; none has run for real. The router is pure code with no network calls: `route(input)` returns `start` (with the lane, the concurrency group `agent-issue-<n>`, and the labels to add and remove), `wait` or `ignore`, each with reasons. Defaults live in `DEFAULT_BUDGET` (2,000 hosted minutes with a soft limit at 80%, Buddy off, 15 minute Oracle grace period). Unlabelled work defaults to the long lane so it costs no hosted minutes, and an unreadable ledger is treated as a used-up hosted pool.

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

### Slice 3: setting up the Oracle VM

Files are in `templates/workspace/runner/`. Everything on the VM is outbound only: no inbound port is opened.

1. Create an Ampere A1 instance (Ubuntu 24.04, arm64, 2 OCPU / 12 GB). Keep the default security list closed except SSH from your address.
2. Clone this repo, then run `templates/workspace/bootstrap.sh`. It installs Node, Claude Code, the git guard and standard settings.
3. As a sudo user: `templates/workspace/runner/install-runner.sh --repo owner/name` (add `--dry-run` first to read the plan). It downloads the Actions runner, checks the published checksum, registers it with the label `oracle`, installs the service and installs the heartbeat timer. Registration uses `RUNNER_TOKEN` or `gh` logged in as a repo admin.
4. As the `runner` user: run `claude` once and log in (`/login`) with the account that should pay for long jobs.
5. As the `runner` user: create `~/.config/factory/heartbeat.env` (mode 600) with `GH_TOKEN=` set to a fine-grained token for this repo only with **Variables read and write** and nothing else.
6. Run `templates/workspace/runner/check-runner.sh`. After the first timer run the repository variable `ORACLE_LAST_SEEN` should exist and keep moving.
7. Record the runner version the installer printed as `RUNNER_VERSION` in `versions.env`.

How the heartbeat works: every five minutes `heartbeat.sh` sets `ORACLE_LAST_SEEN` to the current time, but only when the runner service is active, `claude` runs, no API key is in the environment and the disk has room. The router treats a heartbeat under ten minutes old as online, so one missed beat is tolerated and a broken machine stops receiving long jobs within ten minutes.

Things to know:
- Jobs on this runner use the `runner` user's Claude login. Anything a workflow on `main` runs there can use that account, so keep the repo private and the collaborator list short. The workflows never run pull request code on it.
- The runner keeps itself up to date (GitHub refuses very old runners). Claude Code does not (`DISABLE_AUTOUPDATER=1`); change its version in `versions.env`.
- Idle reclamation: Oracle may reclaim an instance that stays under about 20% CPU, network and memory for 7 days. A runner that waits for jobs is exactly that. If it happens, the heartbeat stops and long jobs wait. Mitigation: upgrade the tenancy to pay-as-you-go (no charge while you stay inside the Always Free limits), which is commonly reported to remove reclamation. Not verified.

### Slice 4: the Buddy burst lane (bonus)

Off until `BUDDY_ENABLED=true`. The router sends a job to `burst` only when asked for it with `lane:burst`, or when a long job has waited more than 15 minutes for Oracle and Buddy has budget left (under 90% of its GB-minutes).

How it runs:
1. `route.yml` claims the issue as usual, then its `burst` job calls `.factory/route/trigger-buddy.sh`, which POSTs the issue number to the pipeline's webhook (`BUDDY_WEBHOOK_URL`, a GitHub secret). If that call fails, the claim is released as `agent:failed` with a comment.
2. The Buddy pipeline has one action, `bash .factory/route/burst.sh`, so the logic stays in the repo. It installs dependencies, finds the lease comment, runs the pipeline through the same `run-pipeline.sh` the other lanes use (one credential, no `GITHUB_TOKEN`, 10 minute heartbeat), then hands the issue back and charges the ledger in GB-minutes.
3. If the webhook did not carry the issue number, `burst.sh` takes the oldest open issue labelled `agent:working` and `lane:burst`.

Setup, once:
1. Create a Buddy workspace and project and connect this repo (default branch `main`).
2. Create a pipeline triggered by webhook only (the Free plan has no trigger conditions or remote YAML, so configure it in the UI). Actions: a Bash action that makes sure `gh` and Claude Code are installed (`npm install -g @anthropic-ai/claude-code@2.1.292`), then a Bash action running `bash .factory/route/burst.sh`.
3. Pipeline variables: `GH_TOKEN` (secret; fine-grained, this repo only, Issues read and write), `GITHUB_REPOSITORY` (`owner/name`), and `CLAUDE_CODE_OAUTH_TOKEN` (secret; from `claude setup-token`) or `ANTHROPIC_API_KEY` (secret).
4. Copy the pipeline's webhook URL into the GitHub secret `BUDDY_WEBHOOK_URL`. Set repository variables `BUDDY_ENABLED=true` and `BUDDY_RUNNER_GB` (the memory of the Buddy runner, so GB-minutes are counted correctly).
5. Try it: open an issue labelled `agent:ready`, `lane:burst` and `task:review`.

Things to know:
- Nothing depends on this lane. With it off, long work waits for Oracle and short work stays on hosted Actions.
- Buddy freezes a free workspace after 60 days without use (reported). An unused bonus lane may need a manual run now and then.
- `BUDDY_RUNNER_GB` defaults to 4, a guess.

### Slice 5: the daily sweep

`.github/workflows/sweep.yml` runs once a day (and on demand) and does three things through `route-cli sweep`:
1. **Dead jobs.** For every open issue labelled `agent:working` it reads the lease comment. A heartbeat older than 30 minutes, or no readable lease, means the job is dead (it crashed, never got a runner, or lost its network). The sweep cancels the Actions run, puts the issue back to `agent:ready`, clears its `lane:*` label and re-dispatches `route.yml` for it, **once**. The restart count lives in the lease marker, so the next claim carries it, and a second stale lease sends the issue to `needs-human` instead of looping. A missing lease goes straight to `needs-human`. Jobs on the Buddy lane are never cancelled by id, because a Buddy execution id is not a GitHub run id. A requeue does not start from scratch: the sweep's comment carries a hidden marker with the dead job's Actions run, and the next job downloads that run's `workflow-state-issue-<n>-<run>` artifact (the state is saved after every stage, and the artifact step runs even when the job is cancelled) and runs `factory retry` on it, so finished phases are kept. If the artifact is missing, or the dead job ran on Buddy, it starts fresh. A resumed requeue is marked used with a comment, like an answer.
2. **Usage report.** Month-to-date hosted minutes, Buddy GB-minutes and Oracle hours go in the run's job summary.
3. **Ledger check.** If the `agent-ledger` marker in the ledger issue is damaged, one warning comment explains how to repair it. Until then the router treats the hosted pool as used up (this part already existed in slice 1).

Cost: when nothing is in flight the workflow ends after one API call, about a minute of hosted time a day. A manual run always goes through, to read the usage report.

Because label events caused by `GITHUB_TOKEN` do not start workflows, the sweep re-dispatches `route.yml` itself. That run is made by `github-actions[bot]`, which the router accepts as a sender (only a workflow on the default branch can act as it; anyone who could trigger such a workflow already has write access).

A job waiting in the queue for a long time counts as dead after 30 minutes without a heartbeat, but with a daily sweep it can sit for up to a day before it is noticed.

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
- Plan approval on the cloud lanes: set the repository variable `FACTORY_PLAN_APPROVAL=1`; the run then asks for the plan on the issue like any other question (`/answer approve`). The variable is passed through the `plan_approval` input of the agent-run action; that `vars` reaches a reusable workflow's `with:` this way has not been run. Use an `until:` label past the architect (such as `until:reviewer`) so an approval starts the build, and note that a stopped run cannot yet be continued from an `until` stop: a new `agent:ready` starts a fresh workflow.
- Resuming a requeued job has the same unknowns as the `/answer` flow, plus one: that the upload-artifact step still runs when the sweep cancels the job (it is `if: always()`, which GitHub documents as running on cancellation, but a hard runner loss uploads nothing and the job then starts fresh).
- The `/answer` flow (`answer.yml`, `route-cli answer` and `resume`) is tested with a fake `gh` and has never run in Actions. Unknown: that `gh run download` of another run's artifact works with `actions: read` and the default token, that the artifact keeps the `workflows/` folder layout when `logs/` is missing (the restore searches the download for the file, so either layout should work), that the `issue_comment` event for a comment made by a collaborator carries the labels in `github.event.issue.labels`, and that `gh workflow run` started from `answer.yml` is accepted with `actions: write`.
- Slice 5 has never run in Actions. In particular: that `gh workflow run` works with `GITHUB_TOKEN` and `actions: write`, that `gh run cancel` accepts the route run id stored in the lease, and that the lease comment query (`last // empty`) behaves with `--paginate` on issues with many comments.
- Slice 4 has never run on Buddy. Unknown: the exact JSON the webhook accepts for variables (`burst.sh` has a fallback that finds the issue by labels), whether the Free plan's runner image has `gh` and Node 20, the maximum run time of a free pipeline, and what a GB-minute costs on the runner you get.
- Slice 3 has never run on a VM: the scripts are tested with stubbed `gh`, `systemctl` and `claude`, and the installer only in dry-run mode. The checksum is read from the runner release notes; if their format differs the installer stops and asks for `--sha256`.
- Slice 2 has never run in Actions. In particular: that a reusable workflow with `secrets: inherit` hands secrets only to the job that references them (the Oracle job references none), that `secrets[fromJSON(...)[inputs.author]]` resolves to empty for an unmapped login, and that a background heartbeat in a composite action survives until the step ends.
