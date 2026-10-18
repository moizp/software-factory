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
- Showing the question on the GitHub issue and resuming from a reply comment is the next step (item A1 in `docs/HUMANLAYER-IDEAS.md`); today the answer is given with the command above.
