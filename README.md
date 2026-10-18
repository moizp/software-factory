# Software Factory

A multi-agent workflow that turns a project brief into a built, tested, reviewed pull request, plus the working practices (trunk-based flow, merge policy, Kanban limits, AI review) that keep agent-written code safe to merge.

Three parts, usable on their own:

| Part | What it does | Where |
|---|---|---|
| **Pipeline** | Runs specialised agents in order, validates every hand-off, resumes after failures | `.factory/`, `.claude/agents/` |
| **Governance** | Decides what an agent may merge and what needs a human; caps work in progress | `.factory/policy.json`, `.factory/board.json`, `.github/workflows/` |
| **Verification** | Independent AI review and PR text checks on every pull request | `.factory/review/`, `.factory/gate/`, `templates/ai-review/` |

## Status

Be clear about what is proven.

| Area | State |
|---|---|
| Pipeline engine (stages, contracts, retry, token budget, `--until`) | Works. Covered by tests with a mock agent invoker. **No full run with the real model has been done yet.** |
| Agents run by the pipeline | product-manager, analyzer, software-architect, backend-engineer, frontend-engineer, infrastructure-engineer, automation-tester, e2e-tester, reviewer, customer-support |
| Agents described but not run | mcp-configurator, platform-architect, ui-designer (see `docs/FACTORY_GAP_ANALYSIS.md`) |
| Merge policy, WIP guard, board sync | Works, used on this repo's own PRs |
| PR text check (`pr-lint.yml`) | Merged; its first real run is the next PR |
| AI review code (`.factory/review/`) | Built and unit-tested. **Never run in GitHub Actions or against the live API.** Setup below is how to test it |
| Changing existing code (change mode), writing code into worktrees, draft PR creation | Not built. A spike exists on branch `spike/phase2-check` |
| Unattended runs in the cloud | Router, workflows and a daily lease sweep written (`route.yml`, `agent-job.yml`, `sweep.yml`), never run in Actions; the Oracle runner scripts exist (`templates/workspace/runner/`) but have not run on a VM; the Buddy burst lane is written, off by default and never run. Plan: [docs/CLOUD-RUNNERS.md](docs/CLOUD-RUNNERS.md) |

## How it fits together

```
brief
  ▼
PIPELINE (local, claude -p, one agent per stage)
requirements → analysis → architecture → build ×3 parallel → test → e2e → review → docs
        each stage: JSON envelope validated, invalid = stop, `factory retry` resumes
  ▼
branch + pull request into main
  ▼
VERIFICATION (GitHub Actions, no PR code runs with secrets)
  ├─ policy-check   labels policy:auto or policy:manual from .factory/policy.json (read from main)
  ├─ pr-lint        title, body, commits: attribution fails, AI tells warn, evidence by risk tier
  ├─ factory-test   build + tests
  └─ ai-review      risk tier R0-R3, grounded findings only, review-result.json   (template, see setup)
  ▼
policy:auto  ──▶ may merge when required checks pass
policy:manual ─▶ a human merges
```

Rules the flow enforces: `main` is the only long-lived branch, short-lived `feature/*`, `fix/*`, `enhancement/*`, `chore/*` branches, **merge commits only**, single-line conventional commits, **no AI attribution** in commits or PRs, and agents never approve a PR or edit `.factory/policy.json` expecting it to apply to their own PR.

## Quick start: run the pipeline locally

Needs Node 18+ and the `claude` CLI logged in. Runs use your Claude plan (default model `claude-sonnet-5-5`, effort `medium`).

```bash
git clone https://github.com/moizp/software-factory && cd software-factory
npm install
cp scripts/credentials.sh.template scripts/credentials.sh   # fill in, then:
source scripts/credentials.sh
npm run build && npm test                                    # 240+ tests, no model calls

# cheap first run: stop after one agent, then continue
npm run factory:start -- "A todo app with user accounts" --until software-architect
npm run factory:list
npm run factory:retry <workflow-id>                          # resume; validated stages are kept
```

`factory:start` runs `scripts/validate-setup.sh` first, which expects `GITHUB_TOKEN`, `DB_PASSWORD` and `STRIPE_MCP_KEY` in the environment. To skip that check: `npx ts-node .factory/cli.ts start "<brief>"`.

Token control: `FACTORY_MAX_TOKENS` (default 600000, `0` disables) pauses before the next stage once reached. The orchestrator also refuses to start new work when the board's WIP limits are full (`FACTORY_IGNORE_WIP=1` overrides).

## Setup: AI review in another project

This is the part to test next. Everything here is untested in Actions, so each step has a check. Use a private repo you can afford to experiment on.

### 1. Copy the files

```bash
# from a clone of this repo; DEST is the target project
DEST=/path/to/project
cp -r .factory tsconfig.json "$DEST"/
mkdir -p "$DEST/templates" "$DEST/.github/workflows"
cp -r templates/ai-review "$DEST/templates/"
cp templates/ai-review/ai-review.yml .github/workflows/policy-check.yml .github/workflows/pr-lint.yml "$DEST/.github/workflows/"
```

Copy `.factory/` whole (the reviewer imports `policy-engine.ts`, `claude-bridge.ts`, `state.ts`, `pipeline.ts`). The reviewer reads its prompts from `templates/ai-review/prompts/` relative to the repo root, so keep that path.

### 2. Install dependencies

The workflows run `npm ci`, so the project needs a `package.json` and a lockfile with:

```bash
npm install ajv chalk
npm install -D typescript ts-node @types/node
```

### 3. Set what needs a human

Edit `.factory/policy.json` `protected_paths` for the project (deploy, auth, migrations, CI, secrets). The review also treats these as R3.

### 4. Create the labels

`ai-review.yml` adds labels but does not create them, and a missing label fails silently:

```bash
gh label create risk:r0 --color 0E8A16 --force;  gh label create risk:r1 --color 1D76DB --force
gh label create risk:r2 --color FBCA04 --force;  gh label create risk:r3 --color D93F0B --force
gh label create ai-review:pass --color 0E8A16 --force
gh label create ai-review:changes --color FBCA04 --force
gh label create ai-review:blocked --color D93F0B --force
```

(`policy:auto` and `policy:manual` are created by `policy-check.yml`.)

### 5. Give Actions a Claude credential

Pick one. The workflow exports exactly one credential per run, in this order, so an API key can never silently shadow an account token.

| Order | Credential | Set with | Billed to |
|---|---|---|---|
| 1 | The PR author's own account | `claude setup-token`, then `gh secret set CLAUDE_OAUTH_<LOGIN>` and map it (below) | That person's Claude plan allowance |
| 2 | A shared account | `gh secret set CLAUDE_CODE_OAUTH_TOKEN` | That account's allowance |
| 3 | Anthropic API key (optional fallback) | `gh secret set ANTHROPIC_API_KEY` | Anthropic Console, metered |
| none | nothing set | | The PR gets `policy:manual`, no review runs |

```bash
claude setup-token                                   # run as the writer; copy the token it prints
gh secret set CLAUDE_OAUTH_ALICE                     # paste it
gh variable set REVIEW_ACCOUNT_MAP --body '{"alice":"CLAUDE_OAUTH_ALICE"}'   # GitHub login -> secret name
```

Check your plan's terms on automated use before relying on an account token in CI. Tokens expire: plan a rotation.

### 6. Variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `AI_REVIEW_MODE` | `shadow` | `shadow`: comment and `risk:*` label only. `enforce`: also `ai-review:*` and `policy:manual` by verdict |
| `AI_REVIEW_ENABLED` | on | Set to `false` to stop all reviews (kill switch) |
| `AI_REVIEW_DAILY_CAP` | `20` | Reviews per UTC day, protects personal allowances |
| `CLAUDE_CODE_VERSION` | `2.1.292` | Pinned CLI version; keep in step with `templates/workspace/versions.env` |
| `AI_REVIEW_MONTHLY_USD` | `25` | **Not enforced yet.** The workflow passes it but nothing reads it |

Start in `shadow` and stay there for about 30 days of real PRs before trusting verdicts.

### 7. Verify

Open a draft PR, then mark it ready, from a branch by a mapped login with a small code change.

| Check | Expect |
|---|---|
| Actions run | `AI Review` ran, the credential step picked the account (log shows `REVIEW_RUNNER=cli`), no secret printed |
| PR | One comment titled `AI review (R1, attempt 1)` with the hidden `ai-review head=... attempt=1` marker, and the `risk:r1` label |
| Artifact | `review-result-<pr>-<sha>` containing `review-result.json` (`status: complete`) |
| Push again | A second comment with `attempt 2`; the older run is cancelled |
| Docs-only PR | Tier R0, no model call, status `complete` |
| PR by an unmapped login with no shared token | `policy:manual`, no review |
| Draft PR | Skipped |
| `AI_REVIEW_ENABLED=false` | Skipped |

### 8. What most likely breaks first

Each of these fails closed (the PR gets `status: failed_closed` and a human decides), so a miss costs a retry, not a bad merge.

- **CLI output shape.** The `cli` runner reads the `result` field of `claude -p --output-format json`. With `--json-schema` the structured answer may arrive in another field (such as `structured_output`) and `result` may be empty. Symptom: every lens fails with "review output is not valid JSON". Fix is in `.factory/review/runners.ts` and `parseCliResult`.
- **Flags.** The pinned CLI must accept `--tools ""`, `--json-schema` and `--append-system-prompt`. Symptom: the CLI exits non-zero in the job log.
- **Secret selection.** `secrets[fromJSON(vars.REVIEW_ACCOUNT_MAP)[login]]` must resolve to empty for an unmapped login. If the job errors at the expression, simplify it to a fixed secret name.
- **Allowance exhausted.** The review fails closed. Reduce `AI_REVIEW_DAILY_CAP` or add the API key fallback.
- **`api` runner** is the least checked: plain `fetch` to the Messages API, never called live.

To use the API key instead of an account, set only `ANTHROPIC_API_KEY` and leave the other two unset.

## Using the pieces on an existing project

`docs/ADOPTING.md` holds a prompt you paste into Claude Code inside an existing project. It surveys the project, then adopts one practice per PR: trunk-based flow, merge policy, Kanban limits, release candidates.

## Governance reference

- **Merge policy** (`.factory/policy.json`, [docs/POLICY.md](docs/POLICY.md)): read from the base branch so a PR cannot loosen its own rules. Protected paths always need a human. Strictest rule wins. Anything unclear fails closed. Docs-only PRs may auto-merge.
- **Board** (`.factory/board.json`, [docs/PROJECT-BOARD.md](docs/PROJECT-BOARD.md)): Backlog, Ready, In progress (WIP 1), In review (WIP 2), Done. The GitHub Project itself is created in the UI.
- **Releases for apps the factory builds**: release candidate branch from `main`, promoted through `www-test`, `www-demo`, `www-prod` pointers, tagged, merged back. See `.claude/skills/release-process.md` and `templates/release/`. This repo has no releases; `main` is the product.
- **Repo settings** that cannot live in code: allow merge commits only, auto-delete head branches. Branch protection is off (free private repo), so the rules are enforced by workflows, labels and hooks.

## Hybrid pipeline: writers and verifiers

[docs/HYBRID-PIPELINE.md](docs/HYBRID-PIPELINE.md) is the plan: persistent writer workspaces (a VPS running Claude Code in tmux, each writer on their own subscription) separated from ephemeral verification in Actions. Parts built:

- Writer workspace scripts in `templates/workspace/` (pinned Node and Claude Code, `doctor.sh`, a pre-push guard that blocks `main`, force pushes and deletes). Not yet run on a real VPS.
- Guardrail prompts in `templates/ai-review/prompts/` and the reviewer in `.factory/review/`.
- Writer skills: `.claude/skills/task-isolation.md` (worktree per task, scope check against open PRs) and `.claude/skills/review-loop.md` (capped fix loop on `review-result.json`, three rounds then `needs-human`).
- Monorepo layout and per-service policy: [docs/MONOREPO.md](docs/MONOREPO.md), `templates/monorepo/`.

Models: Haiku 4.5 for small few-turn work (R1 first pass), Sonnet 5.5 at medium effort for everything else.

## Commands

| Command | Does |
|---|---|
| `npm run build` | Type-check (`tsc`) |
| `npm test` | All tests, mock invoker, no model calls |
| `npm run factory:start -- "<brief>" [--until <agent>]` | Start a workflow |
| `npm run factory:list` / `factory:status <id>` / `factory:watch <id>` | Inspect workflows |
| `npm run factory:retry <id>` | Resume a failed or paused workflow |
| `npm run policy:check -- --base origin/main --head HEAD --branch "$(git branch --show-current)"` | What the merge policy says about your branch |
| `npm run gate:check -- --base origin/main --head HEAD --branch <b> --title "<t>" --body-file body.md` | Run the PR text check locally |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `FACTORY_AGENT_MODEL` | `claude-sonnet-5-5` | Model for pipeline agents |
| `FACTORY_AGENT_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `FACTORY_AGENT_TIMEOUT_MS` | 600000 | Per-agent timeout |
| `FACTORY_MAX_TOKENS` | 600000 | Pause before the next stage once reached; `0` disables |
| `FACTORY_IGNORE_WIP` | unset | `1` starts work even when WIP limits are full |
| `FACTORY_DATA_DIR` | repo root | Where `workflows/` (state) and `logs/` are written |

Project specification lives in `project.config.json` (schema: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

## Layout

```
.factory/            orchestrator, contracts, policy engine, board, review/, gate/, tests
.claude/             CLAUDE.md (orchestrator rules), agents/, skills/
.github/workflows/   factory-test, policy-check, pr-lint, board-sync, route, agent-job, sweep (+ factory-deploy: only echoes)
templates/           ai-review/, workspace/, monorepo/, release/  (copied into other projects)
docs/                POLICY, PROJECT-BOARD, HYBRID-PIPELINE, MONOREPO, ADOPTING, ORCHESTRATION, CONFIGURATION, ...
scripts/             validate-setup, validate-mcp, setup-mcp, credentials template
TODO.md              what is left, with decisions recorded
```

## Documents

| Doc | For |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branching, commits, PRs |
| [docs/POLICY.md](docs/POLICY.md) | Merge policy |
| [docs/PROJECT-BOARD.md](docs/PROJECT-BOARD.md) | Kanban template and WIP limits |
| [docs/HYBRID-PIPELINE.md](docs/HYBRID-PIPELINE.md) | Writer and verifier plan, risk tiers, cost, rollout |
| [docs/MONOREPO.md](docs/MONOREPO.md) | Monorepo layout and splitting into repos |
| [docs/ADOPTING.md](docs/ADOPTING.md) | Bring the practices into an existing project |
| [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md), [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Pipeline internals and debugging |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md), [docs/mcp-setup-guide.md](docs/mcp-setup-guide.md) | Project config and MCP servers |
| [docs/FACTORY_GAP_ANALYSIS.md](docs/FACTORY_GAP_ANALYSIS.md) | What the factory still lacks |
| [TODO.md](TODO.md) | Open work |

## License

MIT
