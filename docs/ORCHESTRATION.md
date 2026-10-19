# Software Factory Orchestration

> **Removed:** the `ready-to-build` issue-label trigger (`factory-start.yml`) was deleted. It pasted the issue title into a shell script (command injection) and could not run, since the runner has no `claude` CLI. The replacement is the event-driven router in [CLOUD-RUNNERS.md](CLOUD-RUNNERS.md). Sections below that mention the label describe the old design.

Complete guide to autonomous multi-agent orchestration workflow—from GitHub issue to production code.

## Architecture Overview

```
[GitHub Issue + "ready-to-build" Label]
              ↓
    [CloudRun Orchestrator Pod]
      ├─ Load project.config.json
      ├─ Validate credentials (MCP Configurator)
              ↓
    [Sequential: Requirements Phase]
      ├─ Product Manager (2 min) → requirements + personas
      ├─ Analyzer (3 min) → tech stack + features
              ↓
    [Parallel: Architecture Phase]
      ├─ Software Architect (5 min) → API spec + DB schema
      ├─ Platform Architect (5 min) → Infrastructure design
      ├─ UI Designer (3 min) → Design system
              ↓
    [Parallel: Builder Phase (Zero Token Cost)]
      ├─ Backend Engineer → API server + auth
      ├─ Frontend Engineer → React components
      ├─ Infrastructure Engineer → Docker + CI/CD
      ├─ Automation Tester → Unit + integration tests
      └─ Customer Support → Documentation
              ↓
    [Sequential: Validation Phase]
      ├─ E2E Tester (8 min) → User workflows
      ├─ Reviewer (5 min) → Security + quality gate
              ↓
    [GitHub PR + All Generated Artifacts + Deployment Ready]
```

## Quick Start

### Three Steps

```bash
# 1. Clone and configure
git clone <repo> my-project && cd my-project
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit credentials.sh with real API keys

# 2. Create GitHub issue with project brief
# Add "ready-to-build" label

# 3. Track progress
# Orchestrator runs automatically, posts status to issue
# Results appear in companion PR when done
```

## Phase Details & Agent Invocation

### Phase 1: Product Manager (Sequential)
**Duration:** 2 minutes  
**Input:** GitHub issue title + body  
**Output:** `{ valid: true/false, persona[], acceptance_criteria[], roadmap }`

Claude Code loads `.claude/agents/product-manager.md` and:
1. Parses issue requirements
2. Generates user personas with goals
3. Creates acceptance criteria (must-have + nice-to-have)
4. Defines success metrics
5. Returns structured JSON

**Validation Gate:** Check `valid === true`, else abort

### Phase 2: Analyzer (Sequential)
**Duration:** 3 minutes  
**Input:** Product Manager output + `project.config.json`  
**Output:** `{ valid: true/false, features[], tech_stack, mcp_servers[], db_outline }`

Claude Code loads `.claude/agents/analyzer.md` and:
1. Extracts tech stack from config
2. Maps features to required MCP servers
3. Outlines database schema
4. Lists API endpoints needed
5. Returns structured JSON

**Validation Gate:** Check `valid === true`, else abort with credential fix guidance

### Phase 3a: Software Architect (Parallel)
**Duration:** 5 minutes  
**Input:** Analyzer output  
**Output:** `{ valid: true/false, api_spec: OpenAPI, prisma_schema, auth_model }`

Claude Code loads `.claude/agents/software-architect.md` and:
1. Generates OpenAPI 3.0 specification
2. Creates Prisma database schema
3. Designs authentication flow (JWT/sessions)
4. Plans error handling strategy
5. Organizes code structure (MVC/layered)

**Validation Gate:** Check `valid === true`, else fix and retry

### Phase 3b: Platform Architect (Parallel)
**Duration:** 5 minutes  
**Input:** Analyzer output  
**Output:** `{ valid: true/false, deployment_arch, scaling_strategy, cost_estimate }`

Claude Code loads `.claude/agents/platform-architect.md` and:
1. Designs cloud infrastructure (serverless/containerized)
2. Plans CI/CD pipeline (GitHub Actions)
3. Sets up monitoring (Datadog/CloudWatch)
4. Designs disaster recovery strategy
5. Calculates infrastructure costs

**Validation Gate:** Check `valid === true`, else fix and retry

### Phase 3c: UI Designer (Sequential)
**Duration:** 3 minutes  
**Input:** Analyzer output  
**Output:** `{ valid: true/false, design_tokens, components[], accessibility_spec }`

Claude Code loads `.claude/agents/ui-designer.md` and:
1. Creates design system (colors, typography, spacing)
2. Specifies all components (Button, Form, Modal, etc.)
3. Defines responsive breakpoints
4. Plans dark mode support
5. Ensures WCAG 2.1 AA compliance

### Phase 4: Builders (Parallel, Zero Token Cost)

All five builders run simultaneously after architects complete.

#### 4a: Backend Engineer
**Duration:** 12 minutes  
**Input:** API spec + Prisma schema  
**Output:** `{ valid: true, code: src/**, tests: **, migrations: ** }`

Generates:
- Express.js server with type safety
- Prisma ORM integration + migrations
- JWT authentication + middleware
- CRUD endpoints for all entities
- Database transaction handling
- Error handling middleware
- Jest unit + integration tests (45+)
- >70% code coverage

#### 4b: Frontend Engineer
**Duration:** 12 minutes  
**Input:** UI design + API spec  
**Output:** `{ valid: true, components: **, pages: **, hooks: ** }`

Generates:
- React components (20+) with TypeScript
- TanStack Query integration (data fetching)
- Zustand store (state management)
- Tailwind CSS styling
- Responsive layouts (mobile/tablet/desktop)
- Dark mode support
- React Testing Library tests
- Form validation + error handling

#### 4c: Infrastructure Engineer
**Duration:** 8 minutes  
**Input:** Platform architect spec  
**Output:** `{ valid: true, docker: **, ci_cd: **, deploy: ** }`

Generates:
- Multi-stage Dockerfile
- docker-compose.yml (dev environment)
- GitHub Actions workflows (lint → test → deploy)
- Environment variable templates
- Database backup scripts
- Health check configurations
- Monitoring dashboards (Datadog)

#### 4d: Automation Tester
**Duration:** 10 minutes  
**Input:** Builder outputs + architect spec  
**Output:** `{ valid: true, tests: **, coverage: number }`

Generates:
- Unit tests (Jest) for all services
- Integration tests with test DB
- API endpoint tests (Supertest)
- Auth flow tests
- Mocking + fixtures
- Coverage reports (>70% target)
- Test utilities + helpers

#### 4e: Customer Support
**Duration:** 8 minutes  
**Input:** All builder outputs + architecture  
**Output:** `{ valid: true, docs: **, api_ref: **, guides: ** }`

Generates:
- Deployment guide (step-by-step)
- API reference (auto from OpenAPI spec)
- Admin guide (configuration, monitoring)
- User guide (feature walkthrough)
- FAQ + troubleshooting
- Onboarding email sequence (4)
- Help center articles

### Phase 5: E2E Tester (Sequential)
**Duration:** 8 minutes  
**Input:** All builder outputs  
**Output:** `{ valid: true, e2e_tests: **, performance_metrics }`

Claude Code loads `.claude/agents/e2e-tester.md` and:
1. Generates Playwright test suite
2. Tests user registration → login → core flow
3. Tests across browsers (Chrome, Firefox, Safari, Edge)
4. Tests responsive design (mobile/tablet/desktop)
5. Measures performance baselines
6. Validates WCAG 2.1 AA compliance

### Phase 6: Reviewer (Sequential, QA Gate)
**Duration:** 5 minutes  
**Input:** All artifacts + test results  
**Output:** `{ valid: true/false, security_issues[], quality_score, approved }`

Claude Code loads `.claude/agents/reviewer.md` and:
1. Runs security audit (OWASP top 10)
2. Checks code quality metrics
3. Verifies test coverage >70%
4. Validates all documentation exists
5. Checks compliance with acceptance criteria
6. Approves deployment readiness

**Final Gate:** Only `valid: true` allows merge to main

## State Machine Diagram

```
    ┌────────────────────────────────────────────────┐
    │         IDLE (waiting for issue label)         │
    └──────────────────┬─────────────────────────────┘
                       │ (ready-to-build label added)
                       ↓
    ┌────────────────────────────────────────────────┐
    │  INIT: Load config + validate credentials      │
    │  - Load project.config.json                    │
    │  - Check GITHUB_TOKEN, API keys exist          │
    │  - Create .factory/workflows/wf-{id}.json      │
    └──────────────────┬─────────────────────────────┘
                       │
         ┌─────────────┴────────────────┐
         │ credentials valid?           │
         └──────┬──────────────┬────────┘
                │              │
               YES             NO
                │              │
                ↓              ↓
         [RUNNING]      [FAILED: Missing Creds]
                │              │
                │              └─→ Post error comment to issue
                ↓                  Workflow stops
    ┌────────────────────────────────┐
    │  PHASE 1: Product Manager      │
    │  (sequential)                  │
    └──────────────┬─────────────────┘
                   │
         ┌─────────┴─────────┐
         │ valid === true?   │
         └────┬──────────┬───┘
             YES         NO
              │          │
              ↓          ↓
         [CONTINUE]  [FAILED]
              │        ↓
              ↓   Retry from this phase
    ┌────────────────────────────────┐
    │  PHASE 2: Analyzer             │
    │  (sequential)                  │
    └──────────────┬─────────────────┘
              ↓
    ┌────────────────────────────────┐
    │  PHASE 3a/3b/3c: Architects    │
    │  (parallel - no token cost)    │
    └──────────────┬─────────────────┘
                   │
         ┌─────────┴───────────┐
         │ all valid === true? │
         └────┬──────────┬────┘
             YES         NO
              │          │
              ↓          ↓
         [CONTINUE]  [FAILED]
              │
              ↓
    ┌────────────────────────────────┐
    │  PHASE 4: Builders (parallel)  │
    │  - Backend Engineer            │
    │  - Frontend Engineer           │
    │  - Infrastructure Engineer     │
    │  - Automation Tester           │
    │  - Customer Support            │
    │  (zero token cost)             │
    └──────────────┬─────────────────┘
                   │
         ┌─────────┴──────────────┐
         │ all valid === true?    │
         └────┬──────────┬────────┘
             YES         NO
              │          │
              ↓          ↓
         [CONTINUE]  [FAILED]
              │
              ↓
    ┌────────────────────────────────┐
    │  PHASE 5: E2E Tester           │
    │  (sequential)                  │
    └──────────────┬─────────────────┘
                   │
         ┌─────────┴─────────┐
         │ valid === true?   │
         └────┬──────────┬───┘
             YES         NO
              │          │
              ↓          ↓
         [CONTINUE]  [FAILED]
              │
              ↓
    ┌────────────────────────────────┐
    │  PHASE 6: Reviewer (QA Gate)   │
    │  - Security audit              │
    │  - Code quality check          │
    │  - Documentation verification  │
    └──────────────┬─────────────────┘
                   │
         ┌─────────┴──────────────────┐
         │ valid === true + approved? │
         └────┬──────────────┬────────┘
             YES             NO
              │              │
              ↓              ↓
         [COMPLETED]   [BLOCKED]
              │              │
              ↓              ↓
    Create PR +        Request changes
    Merge to main      Loop back to Phase 4
              │
              └──→ Post success comment
                   All artifacts in PR
```

## State Persistence

Orchestrator saves state after every phase:

```json
{
  "id": "wf-1704067200000-abc123",
  "issueBrief": "Build real-time chat",
  "issueNumber": 42,
  "status": "running|completed|failed",
  "currentPhase": "backend-builder",
  "startedAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:35:00Z",
  
  "phases": [
    {
      "phase": "product-manager",
      "valid": true,
      "timestamp": "2024-01-01T10:00:30Z",
      "duration_ms": 2000,
      "output": { /* full JSON */ }
    }
  ],
  
  "artifacts": [
    {
      "phase": "architect",
      "type": "openapi-spec|prisma-schema|dockerfile",
      "path": "factory/wf-id/artifact-name",
      "size_bytes": 45821
    }
  ],
  
  "timeline": [
    "[2024-01-01T10:00:00Z] Workflow started",
    "[2024-01-01T10:00:30Z] Product Manager passed"
  ]
}
```

**Location:** `.factory/workflows/wf-{timestamp}-{uuid}.json`  
**Retention:** Permanent (used for audit + retry)

## Validation Gates

Each phase must return:
```json
{
  "phase": "product-manager",
  "valid": true,
  "data": { /* structured output */ },
  "error": null
}
```

**Orchestrator flow:**
```
Phase returns output
        ↓
  valid === true?
   ├─ YES → Save state, proceed to next phase
   └─ NO  → Save state + error, pause workflow
           Can retry from this phase
```

## Parallel Execution Strategy

### Builders Run Zero-Cost Parallel

All 5 Phase 4 builders start simultaneously:

```bash
# Pseudo-code: orchestrator.ts
Promise.all([
  builder(BackendEngineer, architectOutput),
  builder(FrontendEngineer, architectOutput),
  builder(InfrastructureEngineer, architectOutput),
  builder(AutomationTester, architectOutput),
  builder(CustomerSupport, architectOutput)
])
```

**Key:** They share read-only architect output (no token overhead).

### Failure Handling

If **any** builder fails:
1. Orchestrator terminates other builders
2. Saves state with first failure
3. Workflow pauses (can retry)
4. Posts error to GitHub issue

## Troubleshooting

### Common Failures

#### 1. Missing Credentials (Phase INIT)
```json
{
  "phase": "init",
  "valid": false,
  "error": "STRIPE_MCP_KEY not in environment"
}
```

**Fix:**
```bash
# Edit scripts/credentials.sh
export STRIPE_MCP_KEY="sk_test_..."
source scripts/credentials.sh

# Retry workflow
npm run factory:retry wf-1704067200000-abc123
```

#### 2. Builder Type Error (Phase 4)
```json
{
  "phase": "backend-engineer",
  "valid": false,
  "error": "TypeScript compilation failed: Cannot find type 'User'"
}
```

**Root cause:** Architect output missing type definitions  
**Fix:**
1. Review architect output for `prisma_schema`
2. Retry builder with corrected schema
```bash
npm run factory:retry wf-id --from-phase=software-architect
```

#### 3. Security Audit Fails (Phase 6)
```json
{
  "phase": "reviewer",
  "valid": false,
  "security_issues": [
    "SQL injection in user search endpoint",
    "Hardcoded API key in .env.example"
  ]
}
```

**Fix:**
1. Review code in builder output
2. Fix manually or retry builder with corrected spec
3. Re-run reviewer

### Debug Commands

```bash
# Show workflow state
cat .factory/workflows/wf-id.json | jq '.currentPhase, .phases[-1]'

# Show phase output
cat .factory/workflows/wf-id.json | jq '.phases[] | select(.phase=="backend-engineer")'

# Show execution timeline
cat .factory/workflows/wf-id.json | jq '.timeline'

# Show all errors
cat .factory/workflows/wf-id.json | jq '.phases[] | select(.valid==false)'
```

## Security Considerations

### Credential Management
- **Never** commit `scripts/credentials.sh`
- Store in GitHub Secrets if using CI/CD
- Rotate API keys every 90 days

### Code Generation Security
- Reviewer agent audits for OWASP top 10
- Checks for hardcoded secrets
- Validates input sanitization
- Ensures SQL injection prevention

### Access Control
- Only repository owners can create issues
- Only issues with valid label trigger workflow
- Artifacts stored in private `.factory/` directory
- PR requires code review before merge

## Recovery Procedures

### Workflow Stuck (No Progress)

1. **Check current state:**
   ```bash
   npm run factory:status wf-id
   ```

2. **If waiting on credentials:**
   ```bash
   source scripts/credentials.sh
   npm run factory:retry wf-id
   ```

3. **If builder hung:**
   ```bash
   # Kill workflow, restart from last passing phase
   npm run factory:retry wf-id --from-phase=analyzer
   ```

4. **If unsure:**
   ```bash
   # Full cleanup + restart
   rm .factory/workflows/wf-id.json
   npm run factory:start "Brief text" 123
   ```

### Partial Completion Recovery

If workflow completed 7 of 8 phases:

```bash
# Restart from phase 8 (Reviewer) only
npm run factory:retry wf-id --from-phase=reviewer

# Provides all artifacts from phases 1-7
# No need to re-generate code
```

### Database Migration Rollback

If infrastructure phase created migrations:

```bash
# Revert only migrations, keep code
npx prisma migrate resolve --rolled-back <migration-name>

# Then retry infrastructure phase
npm run factory:retry wf-id --from-phase=infrastructure-engineer
```

## CLI Reference

```bash
# Start workflow manually (without GitHub issue)
npm run factory:start "Build real-time chat app" 42

# List all workflows
npm run factory:list

# Show workflow status
npm run factory:status wf-1704067200000-abc123

# Watch real-time progress
npm run factory:watch wf-1704067200000-abc123

# Retry from failure point
npm run factory:retry wf-1704067200000-abc123

# Resume a failed workflow (validated phases are kept, failed ones re-run)
npm run factory:retry wf-1704067200000-abc123

# Clean up workflow state
rm workflows/wf-1704067200000-abc123.json
```

## Performance Tuning

### Parallel Execution
- **Phase 3** (Architects): 5 min each (actual seconds: parallel = no overhead)
- **Phase 4** (Builders): ~12 min max (all 5 run simultaneously)
- **Phase 5** (E2E + Reviewer): ~13 min sequential

**Total time:** ~30-35 minutes end-to-end (not 60+)

### Token Cost Optimization
- Builders share read-only architect output (no duplication)
- State persisted, can resume without re-running prior phases
- Each agent uses specific, minimal prompt context

**Typical cost:** 150K-200K tokens per complete workflow

## GitHub Integration

### Automatic Trigger

```yaml
# .github/workflows/factory-start.yml
on:
  issues:
    types: [labeled]

jobs:
  if: contains(github.event.issue.labels.*.name, 'ready-to-build')
```

### Tracking PR

Workflow creates tracking PR:
```
PR: Factory: #42 - Build real-time chat
Branch: factory/{issue-number}
Status updates after each phase
```

### Status Comments

Orchestrator posts to issue:
```
✅ Workflow started! View progress in PR #789
✅ Analyzer complete → proceeding to architects
✅ All builders passing
✅ E2E tests valid
✅ Reviewer approved → merging to main
```

## Artifact Structure

Generated code in feature branch:

```
factory/{issue-number}/
├── schema.prisma           # Database schema
├── openapi.json            # API specification
├── backend/                # Node.js + Express
│   ├── src/
│   ├── tests/
│   └── migrations/
├── frontend/               # React + TypeScript
│   ├── src/components/
│   ├── src/hooks/
│   └── tests/
├── infrastructure/         # Docker + CI/CD
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .github/workflows/
└── docs/
    ├── DEPLOYMENT.md
    ├── API.md
    ├── USER_GUIDE.md
    └── TROUBLESHOOTING.md
```

## Typical Timeline

```
T+0:00    Issue labeled "ready-to-build"
T+0:05    Product Manager + Analyzer complete
T+0:15    Architects complete (parallel)
T+0:20    UI Designer complete
T+0:35    All 5 Builders complete (parallel, zero token cost)
T+0:45    E2E Tester complete
T+0:50    Reviewer complete + approved
T+0:55    PR created + merged to main
T+1:00    Artifacts available for deployment
```

## Next Steps

1. **Clone repository** and configure credentials
2. **Create GitHub issue** with project brief
3. **Label with** "ready-to-build"
4. **Monitor** progress in companion PR
5. **Deploy** using generated deployment guide

See also:
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) — How to run locally
- [CONFIGURATION.md](./CONFIGURATION.md) — Schema reference
- `.claude/CLAUDE.md` — Agent roles and workflow
- `.factory/README.md` — Orchestrator components

## Asking a person

An agent that cannot proceed without a decision only a person can make should not guess. It returns:

```json
{
  "phase": "analyzer",
  "valid": false,
  "needs_human": {
    "intent": "choose",
    "question": "Which database should the app use?",
    "context": "The brief says 'a relational database' but names none.",
    "urgency": "medium",
    "format": "multiple_choice",
    "choices": ["Postgres", "MySQL", "SQLite"]
  }
}
```

- Only `question` is required. `intent` defaults to `clarify`, `urgency` to `medium`, `format` to `free_text`. `multiple_choice` needs 2 to 8 different choices. A `needs_human` next to `valid: true` is ignored.
- A badly formed question is treated like any bad reply: the agent is re-asked once with what was wrong (see `FACTORY_MAX_REPAIRS`).
- The workflow pauses (`status: paused`), the phase's gate stays invalid, and the question is stored in `humanRequests` in the workflow state. `factory status <id>` shows it.
- `factory answer <id> "<answer>"` checks the answer against the format (`yes_no` accepts yes, no, y, n, approve, reject; `multiple_choice` accepts the option number or its exact text), records it, and resumes: completed phases are kept and the asking agent runs again with `humanAnswers: [{question, answer}]` in its input. `factory retry <id>` refuses while a question is open.
- A phase may ask at most 3 questions; after that it fails, because an agent that keeps asking is stuck.

**On a GitHub issue (cloud lanes).** When a routed run pauses with a question, the job's last step moves the issue from `agent:working` to `needs-human` and posts the question in a comment. The comment carries a hidden marker with the workflow id, the question and the Actions run whose artifact holds the saved state.

1. A person with write access replies with a comment that starts with `/answer`, for example `/answer 2` or `/answer yes, but keep the old API`. `answer.yml` checks the commenter's permission and checks the text against the question's format (a bad answer gets a reply and the question stays open).
2. It records the answer in a comment (also with a marker), moves the issue to `agent:ready` and starts `route.yml`, so lane choice, budget and the lease work as for any other job.
3. The job restores the workflow state from the earlier run's artifact (kept 14 days) and runs `factory answer`, which resumes the paused workflow up to the same `until:` stop. If the artifact is gone, or the question came from the Buddy lane (which keeps none), the pipeline starts again with the question and answer added to the brief.
4. A finished resume posts a "used" comment, so a later `agent:ready` starts fresh. A failed resume keeps the answer: label the issue `agent:ready` again to retry it.

Markers are trusted only on comments written by `github-actions[bot]`; a marker pasted by a person is ignored.

## Handoff files

Whenever a workflow ends without completing (waiting for an answer or plan approval, the token budget, an `--until` stop, a failure, or a job that died), the orchestrator writes `workflows/<id>.handoff.md` beside the state. It is built from the saved state, so it costs no tokens. Front matter: workflow, issue, status, branch, commit, `written_at` and the `resume` command. Sections: why it stopped, the task, a status row per phase, the open question, decisions already made, artifacts, the last eight notes, and numbered next steps matched to the reason (an answer, a raised token budget, a fix then `factory retry`). A completed workflow deletes its handoff.

The file travels with the state as the Actions artifact; on a routed run that failed, the result comment on the issue also carries it in a collapsed block. A job the sweep requeued picks up the state of the run that died (see `docs/CLOUD-RUNNERS.md`). `factory retry <id> --until <agent>` is how a resumed run keeps its stop.

For interactive writer sessions, `/handoff` writes `HANDOFF.md` on the task branch and `/resume-handoff` continues from it; the format is `.claude/skills/handoff.md`. A PR that contains a root `HANDOFF.md` fails the PR text check, so the note never reaches `main`.

## Approving the plan

The architect returns an `implementation_plan` next to its design: 2 to 8 phases, each with `name`, `goal`, `files` (relative paths), `automated_checks` (commands) and `manual_checks` (things only a person can judge). Every phase needs at least one check. A plan that does not parse (no files, an absolute path, a phase with no checks) is rejected like any other contract break and the architect is asked again.

**Review before the build.** With `FACTORY_PLAN_APPROVAL=1` (or `"plan_approval": true` in the workflow config) the workflow pauses right after the architecture stage and asks a person, using the same mechanism as an agent's question (see "Asking a person"): the plan is the question, in a readable summary. Answer `approve` to start the build. Any other answer is read as changes to make: the architect runs again with it under `humanAnswers`, and the revised plan is put to the person again. After 3 rounds the workflow fails. On a GitHub issue this is `needs-human` plus an `/answer approve` comment; on a terminal it is `factory answer <id> "approve"`. On the cloud lanes set the repository variable `FACTORY_PLAN_APPROVAL=1`.

`--until` and approval: the approval question comes before the `--until` stop. With the default `until:software-architect` a routed run ends once the plan is approved. To let an approval start the build, label the issue with a later stop, such as `until:reviewer`.

**Check after the build.** After the build stage the orchestrator compares the plan's files with the builders' `generated_files` and records the result in the workflow notes (`Plan check: Planned but not built (...). Built but not in the plan (...)`). The reviewer receives it as `planCheck` together with the plan's `automated_checks`. Agents run without tools, so the commands are not executed by the factory; the reviewer lists them as "not run" unless a tester's output shows them passing. Running them in CI is not built yet.

## Prompt budgets, the context pack and the event log

**Prompt budgets.** `.factory/prompt-budgets.json` caps, per agent, the size of its instruction file (`instructions`) and of the JSON input it receives (`context`), in estimated tokens (characters / 4). `npm run report:prompts` prints each prompt against its cap and exits 1 when one is over; a test enforces the same, so a prompt cannot quietly grow back. The sample reply under "Output Format" was the bulk of most prompts, so each now shows the shape once: one object per list and two plain values at most (also tested). The ten prompts went from about 28,000 to about 20,000 estimated tokens. That saves roughly 8,000 tokens per full run, about 1.3% of the default `FACTORY_MAX_TOKENS`, so the input an agent receives matters more than its prompt. `npm run report:usage` shows what the agents really cost, per agent, from the usage recorded on every phase gate: calls, average total, input and output, and the share of input served from the prompt cache.

**Context pack.** `.factory/context.ts` builds each agent's input. Keys come in a fixed order, the brief and earlier agents' outputs first and the parts that change between calls (`humanAnswers`, `planCheck`) last, so every call shares the longest possible prefix with a repeated or re-asked call (a re-ask only appends its note after the context). The reviewer and customer-support get the newest artifact of each phase and type instead of every artifact ever recorded. If the input is over the agent's `context` cap, strings and lists are cut in four steps, gentlest first, until it fits; the brief, a person's answers and the plan check are never cut. A cut is recorded as a note in the workflow ("Input for reviewer was shortened to fit its 40000 token cap (allArtifacts 52000 to 31000)"). The caps are guards against a pathological input, not tuned values: watch the notes and the usage report, then adjust. The issue text stays one quoted JSON string inside the input.

**Event log.** Every save appends the change to `workflows/<id>.events.jsonl` before the snapshot `workflows/<id>.json` is written. Events: `workflow_started`, `phase_recorded` (a reply arrived, valid or with its error), `artifact_added`, `note_added`, `human_requested`, `human_replied`, `exchange_updated`, `list_replaced` (a resume dropped failed phases) and `state_changed` (status, tokens and the like). They are derived from the difference between the state being saved and the state the log already describes, so the orchestrator still works on a plain state object. The snapshot is always the replay of the log: `factory replay <id>` prints the timeline, checks the two agree, and with `--write` rebuilds a damaged snapshot from the log. A lost or unreadable snapshot is rebuilt from the log on load. The log travels in the same artifact as the state, and a requeued or answered job restores it with the state, so the history stays unbroken across machines and lanes. A write cut short leaves one unreadable line, which is skipped and closed before the next append. A failure to write the log is reported and never stops a run. Not done: the orchestrator does not yet read its next step from the log (B1 would change statuses with it), and runs started before this change get a starting event from their snapshot on first save.
