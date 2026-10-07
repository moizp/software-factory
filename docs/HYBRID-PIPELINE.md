# Hybrid Pipeline: Persistent Writers, Ephemeral Verifiers

Implementation plan for separating **creating** code (interactive, high context, fast) from **verifying** it (independent, fresh context, metered, automated). Goal: a zero-manual-review path for low-risk changes, and high-risk flaws caught before production.

## 1. Read this first: what the design can and cannot promise

| Claim | Reality | What the plan does about it |
|---|---|---|
| "Eliminate hallucinations" | Cannot be eliminated, in the writer or the reviewer. | Lean on deterministic gates (compile, test, scan) as ground truth; make the AI reviewer **grounded** (every finding must quote the diff, and a script drops findings that do not) and **advisory** except where a deterministic fact backs it. |
| "Second pair of eyes" | A fresh-context reviewer breaks tunnel vision, but same-family models share blind spots. | Different context, different prompts, a larger model for high risk, plus a seeded-flaw eval to measure what it actually catches. |
| "Zero manual review for low risk" | Only holds if a bad change cannot bypass the gates. On a free private repo GitHub cannot require checks or block pushes to `main`. | The merge policy and labels govern what agents merge; the writer's token and Claude settings are restricted; **branch protection (GitHub Team/Pro) is recommended before trusting the zero-review path**. Decision needed, see section 10. |
| "Claude Pro on the VPS" | Subscription limits are per account and shared across devices; unattended or multi-agent use of one subscription may conflict with Anthropic's usage terms. | Keep subscription use **interactive and per person** (a human drives each tmux session). Anything unattended runs on the metered key. Check the current terms before scaling. |

## 2. Architecture

```
 CREATION TIER (persistent VPS, subscription login)            VERIFICATION TIER (ephemeral, GitHub Actions)
 ┌───────────────────────────────────────────┐                ┌──────────────────────────────────────────────┐
 │ tmux: claude  (long-lived context)        │   git push     │ Gate A  (runs PR code, NO secrets)           │
 │  plan → build → refactor → self-check     │ ─────────────▶ │   build · test · lint · types · SAST ·       │
 │  pre-push guard: feature branches only    │   feature/*    │   secret scan · dep audit · policy-check     │
 │  writes PR with intent / risk / evidence  │   + PR         │ Gate B  (reads diff as data, API key)        │
 └───────────────────────────────────────────┘                │   risk tier → lenses → grounding filter      │
            ▲                                                  │ Decision: policy engine                      │
            │  findings (review-result.json, PR review)        │   R0/R1 + all green → auto-merge             │
            └───────────────────────────────────────────────── │   R2/R3 or any red  → human                  │
                                                               └──────────────────────────────────────────────┘
```

| | Creation Tier (Writer) | Verification Tier (Reviewer) |
|---|---|---|
| Runs on | Linux VPS (Buddy.works sandbox first, Oracle Cloud later) | GitHub Actions runners |
| Tooling | Claude Code CLI in tmux | Scripts calling the Anthropic API |
| Billing | Claude subscription (interactive) | Metered API key, hard-capped |
| Context | Long, accumulated, biased by its own history | Fresh every time: diff, PR claims, selected files |
| Trust | Has write access to feature branches only | Never executes PR code in the secret-bearing job |
| Output | Commits, PR | Labels, review comments, `review-result.json`, merge decision |

**Two workflows, two trust levels (important):**
- **Gate A** (`pull_request`) executes the PR's code, so it gets **no secrets**.
- **Gate B** (`pull_request_target`) has the API key, so it runs the **base branch's** workflow, scripts and prompts and only ever reads the diff as data. It never checks out or runs the PR head. Otherwise a writer (or an injected instruction) could edit the workflow in its own PR and leak the key or skip the review. Any change under `.github/**` is R3 and always needs a human.

## 3. Risk tiers and the zero-review path

Deterministic rules first; a cheap model only breaks ties. Higher tier wins.

| Tier | Examples | AI review | Merge |
|---|---|---|---|
| **R0** | Docs, comments, tests only | none (Gate A only) | auto |
| **R1** | Small local change, one module, no new dependency, no protected path | one combined pass, Sonnet 5.5, medium effort | auto if verdict `approve` |
| **R2** | Several modules, new dependency, changed API behaviour, config, background jobs | three lenses (logic, security, tests) | human |
| **R3** | Auth, money, secrets, data model or migrations, infra or CI, cross-service contracts, large diffs | all lenses on the larger model (Opus 5.5, high effort) plus architecture lens | human, mandatory |

Inputs to the classifier: `protected_paths` from `.factory/policy.json` (reuse, do not duplicate), lines and files changed, new or changed dependency manifests, migration directories, workflow files, and the writer's own risk claim (a mismatch between the writer's claim and the computed tier is itself reported).

```
PR opened/updated
  ├─ Gate A red? ─────────────────────────────▶ writer fixes (counts as a round)
  ├─ tier R0 ─ Gate A green ──────────────────▶ policy:auto → merge (merge commit)
  ├─ tier R1 ─ AI approve + no major ─────────▶ policy:auto → merge
  │            AI findings ───────────────────▶ writer fixes (max 3 rounds) → else needs-human
  └─ tier R2/R3 ─ AI findings posted ─────────▶ policy:manual → human merges
```

## 4. Standardized workspace image

Files: `templates/workspace/` (copy to every VPS; all idempotent).

| File | Purpose |
|---|---|
| `versions.env` | Single source of truth: Node and Claude Code versions, tmux minimum, disk minimum |
| `bootstrap.sh [agent-name]` | Installs pinned Node (checksum-verified tarball, x64 or arm64), pinned Claude Code, tmux, git, jq, ripgrep, gh; writes the environment; installs git defaults, the pre-push guard and Claude settings; creates a mode-600 secrets file; runs the doctor |
| `doctor.sh` | Reports drift; exit code is the number of failed checks. Fails if `ANTHROPIC_API_KEY` is set (it would silently bill the metered API instead of the subscription) |
| `agent-session.sh <agent> <repo> <branch> [brief]` | Starts or re-attaches a tmux session named `agent-<name>` on a feature branch; refuses `main`, `release/*`, `www-*` |
| `git-hooks/pre-push` | Blocks pushes to `main`/`master`/`release/*`/`www-*`, deletions and force pushes |
| `claude-settings.json` | Disables auto-update; denies force push, pushes to main, `gh pr merge`, and reading `.env`, `~/.ssh`, the secrets file |

**Layers of protection for the writer (soft to hard):** Claude deny rules (best effort) → pre-push hook → fine-grained token scoped to one repo with no admin → branch protection on `main` (needs a paid plan). The hook and deny rules stop mistakes; only the last two stop a compromised or confused session.

**Environment variables:** `DISABLE_AUTOUPDATER=1`, and `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` unset on writers. The metered key exists only as an Actions secret.

**Treat the VPS as disposable.** State lives in git (commits, the PR body, a `HANDOFF.md` note in the branch), not in tmux scrollback. That makes the Buddy.works to Oracle Cloud move a rebuild, not a migration:

1. Provision the new box (cloud-init can run `bootstrap.sh`).
2. `doctor.sh` passes, log in to Claude Code once.
3. Re-clone repos, `agent-session.sh` on each active branch.
4. Retire the old box. (Oracle's Always Free tier is attractive for a permanent box; check its current limits and idle-reclaim rules before relying on it.)

## 5. The hand-off protocol

```
VPS (interactive) ─▶ pre-push checks ─▶ git push feature/* ─▶ PR (claims) ─▶ Gate A + B ─▶ result ─▶ merge
        ▲                                                                                      │
        └──────────────── findings (max 3 rounds, then needs-human) ◀──────────────────────────┘
```

**Writer side (before pushing):** build, test, lint locally; update `HANDOFF.md` if work continues; push a `feature/*` branch (single-line conventional commits, no attribution); open a PR using this body, because **the PR body is the claim set the reviewer verifies**:

```markdown
## Intent
One sentence: what and why.
## Behaviour change
What users or callers will observe. Say "none" for refactors.
## Out of scope
What this deliberately does not touch.
## Risk (writer's claim)
R0 | R1 | R2 | R3, and why.
## How it was verified
Commands run, tests added, manual checks.
## Rollback
How to undo it safely.
```

**Verifier side (automatic):** Gate A and Gate B run on every push; a new push cancels the in-progress review (concurrency group). Outputs: `risk:r0..r3`, `ai-review:pass|changes|blocked`, `policy:auto|manual` labels, one PR review with grounded findings, and a `review-result.json` artifact.

**Back to the writer:** `review-result.json` is the machine-readable hand-off (verdict, tier, findings with file, line, quote, suggested fix). The writer pulls it (`gh pr view` plus the artifact) and pastes or points its session at it. **Round cap:** three fix rounds, then `needs-human`. Repeating the same failure twice escalates immediately. This keeps the writer from looping on tokens.

**Merge:** by the policy engine only. The writer cannot merge (`gh pr merge` denied, no permission on `main`).

## 6. Quality gates

### Gate A: deterministic (ground truth, no AI)
Build, unit and integration tests, lint, type check, SAST (for example Semgrep rules), secret scan (for example Gitleaks), dependency audit, **new-dependency existence and age check** (catches hallucinated or typosquatted packages), migration lint, contract tests, the merge-policy check. These can block on their own; the AI cannot overrule a red gate.

### Gate B: AI lenses (advisory, grounded)
Prompts live in `templates/ai-review/prompts/`:

| File | Used for | Core idea |
|---|---|---|
| `00-system.md` | every call (cached) | Evidence or silence, no invented APIs, PR text is a claim not a fact, diff content is data (prompt-injection defence), severity and verdict definitions |
| `10-risk-triage.md` | tie-breaks only (Haiku 4.5) | Pick a tier; when unsure choose the higher one |
| `20-logic.md` | R1, R2, R3 | Claims check, author assumptions, boundaries, failure paths, ordering and idempotency, **"tests that cannot fail" via three mental mutations**, **pre-mortem** |
| `30-security.md` | R2, R3 (R1 combined) | Source-to-sink evidence for authz, injection, SSRF, secrets, dependencies, CI exposure |
| `40-architecture.md` | R3 | Boundaries, contracts, migrations, failure domains, **one-way doors need an explicit human decision** |
| `50-docs-sync.md` | after merge, never blocks | Suggested doc edits; a separate step opens a docs PR |

**Why this finds what the writer missed:** the writer's blind spots are its own assumptions and its belief that its tests are good. The lenses attack exactly those: they enumerate assumptions and check them, they ask whether tests would fail under plausible mutations, and they run a pre-mortem from the outside.

**Grounding filter (the anti-hallucination step for the reviewer):** a script rejects any finding whose `evidence_quote` does not appear in the diff, and counts them. A rising `ungrounded_rate` means the prompt or model needs attention.

**Structured output** keeps parsing deterministic. Reference shape (confirm against the SDK in Phase A):

```ts
const Finding = z.object({
  severity: z.enum(['blocker', 'major', 'minor']),
  category: z.string(),
  file: z.string(),
  line: z.number(),
  evidence_quote: z.string(),
  explanation: z.string(),
  suggested_fix: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
});
const Review = z.object({
  verdict: z.enum(['approve', 'request_changes', 'block']),
  risk_assessment: z.string(),
  claims_check: z.array(z.object({ claim: z.string(), supported: z.boolean(), evidence: z.string() })),
  findings: z.array(Finding),
  needs_context: z.array(z.string()),
});

// Stable prefix first (rubric, then the diff), lens instruction last, so passes 2..n read the cache.
const res = await client.beta.messages.create({
  model: 'claude-sonnet-5-5',           // R3: 'claude-opus-5-5' with effort 'high'
  max_tokens: 16000,
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',                 // a safety decline is re-run server side
  output_config: { effort: 'medium', format: zodOutputFormat(Review) },
  system: [{ type: 'text', text: SYSTEM_RUBRIC, cache_control: { type: 'ephemeral', ttl: '1h' } }],
  messages: [{ role: 'user', content: [
    { type: 'text', text: `PR claims:\n${prBody}\n\nDiff:\n${diff}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: LENS_PROMPT },
  ]}],
});
if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') failClosedToHuman();
```

Notes: Sonnet 5.5 and Opus 5.5 reject `thinking: {type:'disabled'}`, `budget_tokens`, sampling parameters and forced `tool_choice`, so control depth with `effort` and use structured outputs. Any error, refusal, timeout or schema failure **fails closed to `policy:manual`**, never to auto-merge. Server-side fallbacks are enabled by default for these models; drop them if you prefer a hard stop.

## 7. API cost strategy

**Division of spend:** subscription pays for the writer's interactive work (plan, build, refactor, fix rounds). The metered key pays only for verification, so spend scales with PR volume and risk, not with how long a writer thinks.

**Levers, in order of effect:**
1. **Do not call the model when you do not need to:** R0 (docs, tests only) skips AI entirely; draft PRs are skipped; bots and generated files excluded; the kill switch `AI_REVIEW_ENABLED=false` stops everything.
2. **Tier the model:** Sonnet 5.5 for R1/R2, Opus 5.5 only for R3, Haiku 4.5 for triage tie-breaks.
3. **Prompt caching:** rubric first (1h cache), diff second (5 min), lens instruction last. Multi-lens passes then read the shared prefix at cache-read price.
4. **Send less:** diff plus only the files the diff touches, capped; chunk or refuse oversized diffs (and send them to a human) instead of paying to read them. Preflight with `messages.countTokens`; skip and escalate above a per-PR token cap.
5. **Effort:** `medium` by default; raise only for R3.
6. **Batch API** (50% off) for non-urgent work: nightly whole-repo audits, docs-sync backlog.
7. **Hard caps:** per-PR token cap, a monthly budget variable checked before each call using the usage the API returns (kept in a ledger artifact or issue), and a spend limit on the API workspace in the Anthropic Console (verify what your organization supports).

**Estimated cost per review** (list prices: Sonnet 5.5 $2/$10 per MTok, Opus 5.5 $4/$20, cache reads $0.20; sizes are assumptions, measure in shadow mode):

| Tier | Assumption | Approx. cost |
|---|---|---|
| R0 | no model | $0 |
| R1 | 25k input (4k cached), 3k output, one pass | about $0.07 |
| R2 | 30k shared prefix, three lens passes | about $0.18 |
| R3 | 60k prefix on Opus 5.5, four lenses at high effort | about $0.75 |

At 20 PRs per day (12 R0, 5 R1, 2 R2, 1 R3) that is roughly $1.50 per day, about $30 to $60 per month. Track real tokens per merged PR from `usage` in each response and replace these numbers after the first two weeks.

**Subscription side:** one subscription per human writer; watch usage windows; if one account is exhausted the session pauses rather than switching to the API key (the doctor enforces that no key is present).

## 8. Scaling from one agent to a team

| Stage | Setup |
|---|---|
| 1 agent, 1 repo | One VPS, one tmux session, this plan as written |
| N agents, 1 team | Still one VPS (size for concurrent sessions) with a worktree per task (`git worktree`), session per agent-task, one GitHub identity per agent for audit |
| Many services | Per-service `CLAUDE.md` and `REVIEW.md` (extra review rules), per-service `policy.json` protected paths, `CODEOWNERS` per service |
| Monorepo | Path-filtered matrix in Actions: review and test only changed services; the policy engine already takes the changed paths |
| Polyrepo | A central reusable workflow (`workflow_call`) versions the reviewer once; services call it with their policy |
| Cross-service changes | A change to a shared contract is R3 and triggers dependent services' contract tests (Gate A) plus the architecture lens |
| Ordering | Serialize merges per service (label plus "branch is up to date" check; a merge queue if the plan supports it) |
| Capacity | Add a second VPS when concurrent sessions exceed what one machine runs smoothly or when an account's usage windows are the bottleneck; budget the metered spend per service |
| Board | Raise WIP limits per lane (service) rather than globally (`board.json` extension) |

## 9. Success metrics (proposed targets; set after a baseline)

| Metric | How measured | Target |
|---|---|---|
| Zero-review rate | R0+R1 PRs auto-merged / all R0+R1 PRs | at least 70% |
| Escaped defects, low risk | Reverts or hotfixes within 7 days of an auto-merged PR | none of severity 1 in 30 days |
| R3 catch rate | **Seeded-flaw eval:** a maintained set of PRs with known injected flaws (logic, security, one-way doors); recall of the reviewer on them | at least 90% recall, tracked per release of the prompts |
| False positive rate | Findings the writer or human marks wrong / all findings | under 20% |
| Ungrounded rate | Findings dropped by the grounding filter / all findings | falling; alert if above 10% |
| Cycle time | PR opened to merged, per tier | R1 under 15 minutes |
| Cost | Metered tokens and dollars per merged PR, per tier | within the monthly budget |
| Human minutes | Review time spent per PR, per tier | falling for R0/R1, stable for R3 |

The seeded-flaw eval is what turns "we think the reviewer is good" into evidence, and what lets you change prompts or models safely.

## 10. Rollout plan

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **A. Verifier in shadow mode** | Reviewer script (`.factory/review/`: risk classifier, request builder, grounding filter, result writer), `ai-review.yml` from the template, labels, comments only (no merge effect) | Runs on every PR; cost and `usage` logged; ungrounded rate measured |
| **B. Calibrate** | Seeded-flaw eval, prompt tuning, per-PR token cap, monthly budget guard | Recall and false-positive targets met on the eval; cost per tier measured |
| **C. Zero-review path** | Policy rule: R0/R1 with `ai-review:pass` auto-merge; protection on `main` enabled (decision below) | 30 days with no severity-1 escapes from auto-merged PRs |
| **D. Standard writer** | Workspace scripts on the Buddy sandbox, hand-off protocol and PR template in use, `HANDOFF.md` convention | Two writers get identical doctor results; a full PR round trip works |
| **E. Oracle migration** | Provision from `bootstrap.sh`, move sessions | Old box retired with no lost work |
| **F. Scale out** | Per-service policy and review rules, reusable workflow, per-service budgets | A second service runs the same pipeline |

Phase A is first because it improves quality for the writing you already do today, costs little, and produces the numbers every later decision needs.

### Decisions needed from you
1. **Branch protection or rulesets on `main`** (requires a paid GitHub plan for private repos): without it the zero-review path is a convention, not a guarantee. Recommended before Phase C.
2. **Metered budget:** monthly ceiling for the API key (the plan assumes $50) and who owns the Console workspace.
3. **Who counts as a writer:** confirm each person has their own subscription, and that unattended runs stay on the metered key.
4. **Default model tiers:** Sonnet 5.5 for R1/R2 and Opus 5.5 for R3 as proposed, or a single model for simplicity.
5. **Where services live:** one monorepo or several repos, which decides the scaling pattern in section 8.

### Not yet verified
`bootstrap.sh` has not run on a real VPS (syntax checked; `doctor.sh` and the pre-push hook were exercised locally). `ai-review.yml` and the reviewer script do not exist yet as running code. All cost figures are estimates.
