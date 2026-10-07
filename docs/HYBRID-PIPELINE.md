# Hybrid Pipeline: Persistent Writers, Ephemeral Verifiers

Implementation plan for separating **creating** code (interactive, high context, fast) from **verifying** it (independent, fresh context, automated). Goal: a zero-manual-review path for low-risk changes, and high-risk flaws caught before production.

## 1. Read this first: what the design can and cannot promise

| Claim | Reality | What the plan does about it |
|---|---|---|
| "Eliminate hallucinations" | Cannot be eliminated, in the writer or the reviewer. | Lean on deterministic gates (compile, test, scan) as ground truth; make the AI reviewer **grounded** (every finding must quote the diff, and a script drops findings that do not) and **advisory** except where a deterministic fact backs it. |
| "Second pair of eyes" | A fresh-context reviewer breaks tunnel vision, but same-family models share blind spots. | Different context, different prompts, a larger model for high risk, plus a seeded-flaw eval to measure what it actually catches. |
| "Zero manual review for low risk" | Only holds if a bad change cannot bypass the gates. On a free private repo GitHub cannot require checks or block pushes to `main`, and **protection stays off by decision**. | The merge policy and labels govern what agents merge; the writer's token and Claude settings are restricted; rollout starts with R0 only and adds R1 after 30 days of evidence. Branch protection remains the recommended upgrade. See section 10. |
| "Claude Pro on the VPS and in Actions" | Subscription limits are per account, shared across devices, and shared between a person's interactive work and any CI runs on the same account. Automated use of consumer subscriptions may conflict with Anthropic's usage terms. | Decision: **Actions run on personal Claude accounts** via `claude setup-token` (the CLI's supported long-lived token), with an **Anthropic API key as an optional fallback** (section 6a). Each person's allowance pays for their own PRs, reviews fail closed when an allowance runs out, and the terms need a check before this scales beyond your own repositories. |

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
| Tooling | Claude Code CLI in tmux | Scripts running `claude -p` on a personal account, or calling the Messages API when only an API key exists |
| Billing | Claude subscription (interactive) | Personal account allowance (primary); metered API key only as an optional, capped fallback |
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
| **R1** | Small local change, one module, no new dependency, no protected path | one combined pass on **Haiku 4.5**; any major finding or low confidence re-runs once on Sonnet 5.5 | auto if the final verdict is `approve` |
| **R2** | Several modules, new dependency, changed API behaviour, config, background jobs | three lenses (logic, security, tests) on **Sonnet 5.5, medium effort** | human |
| **R3** | Auth, money, secrets, data model or migrations, infra or CI, cross-service contracts, large diffs | all lenses plus architecture lens on **Sonnet 5.5, medium effort** (a larger model is an optional escalation, see section 7) | human, mandatory |

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

**Environment variables:** `DISABLE_AUTOUPDATER=1`, and `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` unset on writers. Account tokens (and the optional API key) exist only as Actions secrets, never on a writer machine.

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
  model: 'claude-sonnet-5-5',           // R1 first pass: 'claude-haiku-4-5' (omit effort; see notes)
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

Haiku 4.5 differences for the R1 first pass: omit `output_config.effort` (it errors on Haiku 4.5), do not send `thinking` (any thinking there uses a token budget, not adaptive), expect a 200K context window (cap the diff and send larger ones to Sonnet or a human), and confirm structured outputs against the SDK in Phase A.

Notes: Sonnet 5.5 rejects `thinking: {type:'disabled'}`, `budget_tokens`, sampling parameters and forced `tool_choice`, so control depth with `effort` and use structured outputs. Any error, refusal, timeout or schema failure **fails closed to `policy:manual`**, never to auto-merge. Server-side fallbacks are enabled by default for these models; drop them if you prefer a hard stop.

### 6a. Running Claude in Actions: personal accounts first, API key optional

Two interchangeable runners behind one interface (`review(request) -> Review`):

| Runner | Credential | How it calls Claude | When |
|---|---|---|---|
| `cli` (default) | `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` | `claude -p --output-format json --tools "" --json-schema <schema> --model <m> --effort medium`, prompt on stdin, run from an empty directory (small fixed context, as in the factory's own agent runner) | a personal or shared account token exists |
| `api` (fallback) | `ANTHROPIC_API_KEY` | Messages API as in the code sample above | no account token, or the owner prefers metered billing |

**Selection order, per PR:** the PR author's own account token, then a shared account token, then the API key, then none. With none, the review is skipped and the PR is labelled `policy:manual` (fail closed).

**Rules that avoid silent surprises:**
- **Export exactly one credential.** If `ANTHROPIC_API_KEY` is present, Claude Code uses it instead of the subscription login and bills the API. The selection step exports one and unsets the other.
- **Never use `--bare` with an account token.** In bare mode Claude Code reads only an API key, never OAuth.
- Haiku runs omit `--effort`; Sonnet 5.5 runs use `--effort medium` (the same rules as the API).
- Pin the CLI version (`CLAUDE_CODE_VERSION`, the same value as the writer workspace) so reviews do not change behaviour between runs.

**Setting it up (once per person):**
1. On any machine with a browser: `claude setup-token` (needs that person's subscription) and copy the token it prints.
2. Store it as a repository secret named `CLAUDE_OAUTH_<GITHUB_LOGIN_UPPERCASE>`, for example `CLAUDE_OAUTH_ALICE` (GitHub CLI: `gh secret set CLAUDE_OAUTH_ALICE`).
3. Add the login to the repository variable `REVIEW_ACCOUNT_MAP`, for example `{"alice":"CLAUDE_OAUTH_ALICE","bob":"CLAUDE_OAUTH_BOB"}`.
4. Optional shared fallback account: secret `CLAUDE_CODE_OAUTH_TOKEN`. Optional API fallback: secret `ANTHROPIC_API_KEY`.
5. Rotate tokens on a schedule, and revoke one by signing that device or token out of the account.

**Risks to accept knowingly:**
- **Terms and fair use:** `setup-token` is the CLI's supported way to authenticate non-interactive runs, but check your plan's terms for automated use, especially if the repository is shared with other people.
- **Shared allowance:** reviews draw on the same usage windows as that person's interactive work. The daily cap and the Haiku-first, skip-R0 rules exist to protect it; heavy CI days can still slow the writer. A busy repository may need the API fallback or a dedicated account.
- **Token exposure:** a long-lived token is a credential for the whole account. It is stored as a repo secret, only visible to workflows running base-branch code (the `pull_request_target` design in section 2), and any PR that touches `.github/**` is R3.
- **Account ties to a person:** if someone leaves, their secret is removed and their PRs fall back to the shared account, the API key, or manual review.

## 7. API cost strategy

**Division of spend:** each writer's own subscription pays for their interactive work (plan, build, refactor, fix rounds) and, by default, for the reviews of their own PRs in Actions. The optional API key (if provisioned) is a fallback that bills separately. Either way, verification cost scales with PR volume and risk, not with how long a writer thinks.

**Levers, in order of effect:**
1. **Do not call the model when you do not need to:** R0 (docs, tests only) skips AI entirely; draft PRs are skipped; bots and generated files excluded; the kill switch `AI_REVIEW_ENABLED=false` stops everything.
2. **Tier the model (decided):** Haiku 4.5 for simple, few-turn work (R1 first pass, triage tie-breaks); Sonnet 5.5 at medium effort for everything else. Escalate on signal, not by default: a Haiku finding of major severity or low confidence re-runs once on Sonnet. A larger model (for example Opus 5.5) stays an optional knob for R3 only if the seeded-flaw eval shows Sonnet missing real flaws.
3. **Prompt caching:** rubric first (1h cache), diff second (5 min), lens instruction last. Multi-lens passes then read the shared prefix at cache-read price.
4. **Send less:** diff plus only the files the diff touches, capped; chunk or refuse oversized diffs (and send them to a human) instead of paying to read them. Preflight with `messages.countTokens`; skip and escalate above a per-PR token cap.
5. **Effort:** `medium` on Sonnet 5.5 everywhere; raise only if the eval shows missed flaws.
6. **Batch API** (50% off) for non-urgent work: nightly whole-repo audits, docs-sync backlog.
7. **Hard caps:** per-PR token cap; a daily cap on Sonnet reviews per account (a repository variable) so CI cannot drain a person's allowance; usage from each response (`usage` in the CLI JSON or the API response) written to a ledger artifact; and, only when the API-key fallback is enabled, a monthly dollar cap (`AI_REVIEW_MONTHLY_USD`, proposed $25) plus a spend limit on the API workspace in the Console (verify what your organization supports).

**Estimated cost per review** (list prices: Haiku 4.5 $1/$5 per MTok, Sonnet 5.5 $2/$10, cache reads $0.20; sizes are assumptions, measure in shadow mode):

| Tier | Assumption | Approx. cost |
|---|---|---|
| R0 | no model | $0 |
| R1 | 25k input (4k cached), 2k output, one Haiku pass (about 20% re-run on Sonnet) | about $0.03 to $0.05 |
| R2 | 30k shared prefix, three lens passes | about $0.18 |
| R3 | 60k prefix on Sonnet 5.5, four lenses at medium effort | about $0.40 |

At 20 PRs per day (12 R0, 5 R1, 2 R2, 1 R3) that is roughly $0.80 per day, about $20 to $40 per month. Track real tokens per merged PR from `usage` in each response and replace these numbers after the first two weeks.

**What pays for what (important):** the Pro plan allowance covers Claude Code runs authenticated with that account's token; it does **not** fund API-key usage, which is billed separately through the Console. Decision: Actions use **personal account tokens first** (the PR author's, then an optional shared one), and the API key is used **only when no account token is available**. Dollar figures above are API list prices; on a personal account the same numbers show how much of the allowance a review consumes.

**Subscription side:** each human writer has their own subscription (confirmed). Interactive sessions on the VPS never fall back to an API key (the doctor enforces that no key is present). In Actions, if a person's allowance is exhausted the review fails closed to a human, or falls back to the API key if one is configured.

## 8. Scaling from one agent to a team

| Stage | Setup |
|---|---|
| 1 agent, 1 repo | One VPS, one tmux session, this plan as written |
| N agents, 1 team | Still one VPS (size for concurrent sessions) with a worktree per task (`git worktree`), session per agent-task, one GitHub identity per agent for audit |
| Many services | Per-service `CLAUDE.md` and `REVIEW.md` (extra review rules), per-service `policy.json` protected paths, `CODEOWNERS` per service |
| **Monorepo (chosen)** | Layout, per-service files, path-filtered matrix and per-service policy rules are in `docs/MONOREPO.md` and `templates/monorepo/`; the policy engine already works on changed paths |
| Several repos (later option) | A central reusable workflow (`workflow_call`) versions the reviewer once; services call it with their policy. Split recipe and notes: `docs/MONOREPO.md` section 4 |
| Cross-service changes | A change to a shared contract is R3 and triggers dependent services' contract tests (Gate A) plus the architecture lens |
| Ordering | Serialize merges per service (label plus "branch is up to date" check; a merge queue if the plan supports it) |
| Capacity | Add a second VPS when concurrent sessions exceed what one machine runs smoothly or when an account's usage windows are the bottleneck; budget the allowance and any API fallback per service |
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
| Cost | Tokens (and API-equivalent dollars) per merged PR, per tier; share of each account's allowance used by CI | within the daily cap and, if the API fallback is on, the monthly budget |
| Human minutes | Review time spent per PR, per tier | falling for R0/R1, stable for R3 |

The seeded-flaw eval is what turns "we think the reviewer is good" into evidence, and what lets you change prompts or models safely.

## 10. Rollout plan

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **A. Verifier in shadow mode** | Reviewer script (`.factory/review/`: risk classifier, request builder, grounding filter, result writer), `ai-review.yml` from the template, labels, comments only (no merge effect) | Runs on every PR; cost and `usage` logged; ungrounded rate measured |
| **B. Calibrate** | Seeded-flaw eval, prompt tuning, per-PR token cap, monthly budget guard | Recall and false-positive targets met on the eval; cost per tier measured |
| **C. Zero-review path** | Policy rule: R0 auto-merges first; R1 with `ai-review:pass` joins after 30 days of shadow evidence (branch protection stays off) | 30 days with no severity-1 escapes from auto-merged PRs |
| **D. Standard writer** | Workspace scripts on the Buddy sandbox, hand-off protocol and PR template in use, `HANDOFF.md` convention | Two writers get identical doctor results; a full PR round trip works |
| **E. Oracle migration** | Provision from `bootstrap.sh`, move sessions | Old box retired with no lost work |
| **F. Scale out (monorepo)** | Service resolver reading `services.json` (changed files to services and dependents), Gate A matrix, per-service `REVIEW.md` in the reviewer, per-service policy rules and board lane, per-service budgets | A second service runs the same pipeline in the same repo |

Phase A is first because it improves quality for the writing you already do today, costs little, and produces the numbers every later decision needs.

### Decisions (all settled)
- **Models:** Haiku 4.5 for simple few-turn work, Sonnet 5.5 at medium effort for everything else; no larger model by default.
- **Writers:** each human writer has their own Claude subscription; unattended runs never use it.
- **Actions:** run Claude on **personal accounts** (each writer's `claude setup-token` token, section 6a), with an **Anthropic API key as an optional fallback** when available.
- **Budget:** on personal accounts the limit is each plan's allowance (guarded by a daily review cap, Haiku-first and skip-R0 rules). If the API-key fallback is enabled it has its own cap: $25 per month to start (`AI_REVIEW_MONTHLY_USD=25` plus a Console spend limit), raised after two weeks of measured spend.
- **Branch protection on `main`: stays off** (free private repo). The zero-review path is therefore a convention plus the policy, labels, the writer's guards and a restricted token, not a GitHub-enforced guarantee. Consequence for rollout: Phase C starts with **R0 only**, and R1 auto-merge is enabled only after 30 days of shadow-mode evidence (no severity-1 escapes, recall target met). Revisit if the plan is upgraded.
- **Repository layout:** monorepo, with notes for splitting into several repos later (`docs/MONOREPO.md`).

### Not yet verified
`bootstrap.sh` has not run on a real VPS (syntax checked; `doctor.sh` and the pre-push hook were exercised locally). `ai-review.yml` and the reviewer script do not exist yet as running code. The `cli` runner (`claude -p` with `--json-schema` on an account token) and the secret-selection expression in `ai-review.yml` have never run in Actions; whether Claude Code accepts the token in that environment is checked in Phase A's first run. Haiku 4.5 as the R1 reviewer is untested: whether it catches enough is exactly what the seeded-flaw eval in Phase B decides. All cost figures are estimates.
