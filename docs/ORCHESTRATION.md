# Software Factory Orchestration

Complete guide to the autonomous end-to-end orchestration workflow.

## Overview

The software factory orchestrator automates the entire journey from user requirements to production-ready code:

```
[Issue Created]
      ↓
[Labeled "ready-to-build"]
      ↓
[GitHub Actions Trigger]
      ↓
[Factory Orchestrator]
      ├─ Sequential: Product Manager → Analyzer → Architect
      ├─ Parallel: Backend/Frontend/Infrastructure Builders
      ├─ Parallel: Backend/Frontend/Infrastructure Testers
      └─ Sequential: E2E → Reviewer → Customer Support
      ↓
[Production Code + PR + Documentation]
```

## Quick Start

### 1. Label an Issue

Add `ready-to-build` label to any GitHub issue.

### 2. Workflow Automatically Starts

GitHub Actions detects the label and invokes the orchestrator:

```yaml
# .github/workflows/factory-start.yml automatically runs
```

### 3. Monitor Progress

Track real-time status in the workflow's companion PR.

### 4. Review Results

When complete, the PR contains all production code.

## Workflow Phases

### Phase 1: Product Manager (Sequential)
**Purpose:** Validate and refine requirements  
**Input:** Issue title + body  
**Output:** Refined scope, acceptance criteria  
**Time:** ~1-2 minutes  
**Success Criteria:** Requirements are clear, feasible, and specific

### Phase 2: Analyzer (Sequential)
**Purpose:** Determine technical needs  
**Input:** Refined requirements  
**Output:**
- Feature breakdown
- MCP servers required
- Database schema outline
- Tech stack confirmation

**Success Criteria:** All dependencies identifiable, no blockers

### Phase 3: Architect (Sequential)
**Purpose:** Design the system  
**Input:** Analyzer output  
**Output:**
- System architecture (ASCII diagram)
- Database schema (Prisma/TypeScript)
- API contracts (OpenAPI spec)
- Deployment architecture

**Success Criteria:** Design is implementable and scalable

### Phase 4a: Backend Builder (Parallel)
**Purpose:** Generate API code  
**Input:** Architecture output  
**Output:**
- Express/Node.js server code
- Prisma ORM models
- Database migrations
- Auth middleware
- API route handlers
- Business logic

**Success Criteria:** Code compiles, passes lint, no TypeScript errors

### Phase 4b: Frontend Builder (Parallel)
**Purpose:** Generate UI code  
**Input:** Architecture output  
**Output:**
- React components
- Page layouts
- State management setup (TanStack Query)
- Styling (Tailwind CSS)
- Type definitions

**Success Criteria:** Code compiles, passes lint, no TypeScript errors

### Phase 4c: Infrastructure Builder (Parallel)
**Purpose:** Generate deployment configs  
**Input:** Architecture output  
**Output:**
- Dockerfile (multi-stage build)
- docker-compose.yml
- GitHub Actions CI/CD workflows
- Environment configuration
- Secrets management

**Success Criteria:** Configs are syntactically valid, deployable

### Phase 5: Testers (Parallel)
**Purpose:** Ensure code quality  
**Input:** Builder outputs  

#### 5a: Backend Tester
- Unit tests (Jest)
- Integration tests (database)
- API endpoint tests
- Auth flow tests

#### 5b: Frontend Tester
- Component tests (React Testing Library)
- Integration tests (with mocks)
- E2E snippets (Playwright examples)

#### 5c: Infrastructure Tester
- Docker image build validation
- docker-compose validation
- CI/CD workflow dry-run
- Config file validation

**Success Criteria:** >80% code coverage, all tests pass

### Phase 6: E2E Tester (Sequential)
**Purpose:** Validate full system  
**Input:** All builder + tester outputs  
**Output:**
- End-to-end test suite
- System health report
- Performance baseline

**Success Criteria:** All flows work as specified, no integration issues

### Phase 7: Reviewer (Sequential)
**Purpose:** QA and security audit  
**Input:** All artifacts  
**Output:**
- Security audit report
- Code quality metrics
- Performance review
- Documentation completeness check

**Success Criteria:**
- No critical security issues
- Code quality score >85%
- All files documented

### Phase 8: Customer Support (Sequential)
**Purpose:** Create deployment + user guides  
**Input:** Final code + all documentation  
**Output:**
- Deployment guide
- API documentation
- Admin guide
- User guide
- Troubleshooting guide

**Success Criteria:** Complete, clear, production-ready documentation

## State Management

The orchestrator persists state after every phase:

```
.factory/workflows/
└── wf-1704067200000-abc123def.json
```

Each state file contains:
- Workflow ID and metadata
- List of completed phases (with validation results)
- All generated artifacts
- Execution timeline
- Error messages (if any)

### State Structure

```typescript
{
  // Workflow metadata
  "id": "wf-1704067200000-abc123def",
  "issueBrief": "Build real-time chat",
  "issueNumber": 42,
  "status": "running|completed|failed",
  "currentPhase": "backend-builder",
  
  // Execution timeline
  "startedAt": "2024-01-01T10:00:00Z",
  "updatedAt": "2024-01-01T10:35:00Z",
  
  // Phase tracking
  "phases": [
    {
      "phase": "product-manager",
      "valid": true,
      "timestamp": "2024-01-01T10:00:30Z",
      "output": { /* agent output */ }
    },
    ...
  ],
  
  // Generated artifacts
  "artifacts": [
    {
      "phase": "architect",
      "type": "database-schema",
      "content": { /* Prisma schema */ },
      "timestamp": "2024-01-01T10:05:00Z"
    },
    ...
  ],
  
  // Execution log
  "notes": [
    "[2024-01-01T10:00:00Z] Workflow started",
    "[2024-01-01T10:00:30Z] Product Manager phase completed"
  ]
}
```

## Validation Gates

Each phase must pass validation before proceeding:

```
Phase completes
  ↓
Returns { valid: true/false, output, error? }
  ↓
Orchestrator checks: valid === true?
  ├─ YES → Save state, continue to next phase
  ├─ NO → Save state, mark workflow as 'failed'
  └─ Workflow can be retried from this point
```

## Parallel Execution

Builders and Testers run in parallel:

```
[Architect Complete]
         ↓
    ┌────┴────┬────────────┐
    ↓         ↓            ↓
[Backend] [Frontend] [Infrastructure]
  Builder  Builder      Builder
    ↓         ↓            ↓
    └────┬────┴────────────┘
         ↓
  [All Builder Outputs Collected]
         ↓
    ┌────┴────┬────────────┐
    ↓         ↓            ↓
[Backend] [Frontend] [Infrastructure]
  Tester    Tester       Tester
    ↓         ↓            ↓
    └────┬────┴────────────┘
         ↓
 [Testers Complete - Proceed to E2E]
```

**Key constraint:** If ANY parallel phase fails, the entire workflow stops.

## Retry Mechanism

Failed workflows can be retried from the first failed phase:

```bash
npm run factory:retry wf-1704067200000-abc123def
```

**Process:**
1. Load previous workflow state
2. Remove all phases after the first failure
3. Create new workflow ID
4. Restart orchestrator from failure point
5. Preserve earlier artifacts

## GitHub Integration

### Automatic Trigger

When an issue is labeled `ready-to-build`:

```yaml
on:
  issues:
    types: [labeled]

jobs:
  if: contains(github.event.issue.labels.*.name, 'ready-to-build')
```

### Tracking PR

Workflow automatically creates a PR to track progress:

```
PR Title: Factory: #42 - Build real-time chat
Branch: factory/42
Status: Updates after each phase completes
```

### Status Updates

Issue receives automated comments:

```
✅ Factory workflow started! Follow progress in PR #789
✅ Analyzer complete, proceeding to Architect
✅ Builders running in parallel
✅ All tests passed, starting E2E testing
✅ Workflow complete! Code merged to main
```

## Monitoring

### List Active Workflows

```bash
npm run factory:list
```

Output:
```
Workflow: wf-1704067200000-abc123def
  Status: running
  Phase: backend-builder
  Issue: #42
  Started: 2024-01-01T10:00:00Z
```

### Check Workflow Status

```bash
npm run factory:status wf-1704067200000-abc123def
```

### Watch Real-Time Progress

```bash
npm run factory:watch wf-1704067200000-abc123def
```

Live updating dashboard showing:
- Current phase
- Phase completion status
- Error messages
- Execution timeline

## Artifact Output

Generated code is organized by type:

```
.factory/workflows/wf-xxx/
├── schema.prisma          (Database schema)
├── api-spec.openapi.json  (API contracts)
├── backend/
│   ├── src/
│   ├── migrations/
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
├── infrastructure/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .github/workflows/
└── docs/
    ├── DEPLOYMENT.md
    ├── API.md
    └── USER_GUIDE.md
```

All artifacts committed to feature branch `factory/{issue-number}`.

## Error Handling

### Common Failures

**Analyzer fails (MCP servers unavailable)**
```
Error: STRIPE_MCP_KEY not in environment
Action: Set environment variable, retry workflow
```

**Builder fails (code generation issue)**
```
Error: TypeScript compilation failed
Action: Check architect output, retry builder
```

**Reviewer fails (security issues)**
```
Error: SQL injection vulnerability in user input
Action: Review code, fix, retry reviewer
```

### Debugging

View detailed logs:

```bash
npm run factory:status wf-id | grep -A5 error
```

Read workflow state file directly:

```bash
cat .factory/workflows/wf-id.json | jq '.notes'
```

## Workflow Lifetime

```
[Created]
    ↓
[Running] ← Current phase executed, state persisted
    ↓
[Completed] ← All phases passed
OR
[Failed] ← Phase validation failed
    ↓
[Can be retried]
```

**Retention:** Workflows remain in `.factory/workflows/` indefinitely.

## Cost & Performance

**Typical Workflow Runtime:**
- Sequential phases (Product Manager → Analyzer → Architect): ~10 min
- Parallel builders: ~8 min
- Parallel testers: ~5 min
- Sequential final phases (E2E → Reviewer → Support): ~5 min

**Total: ~25-30 minutes end-to-end**

**Token Cost:** ~150K tokens per full workflow (using mock agents; real agents may vary)

## Next Steps

1. **Label an issue** with `ready-to-build`
2. **Monitor the PR** created automatically
3. **Review generated code** when workflow completes
4. **Merge or iterate** based on review feedback
5. **Deploy** using included deployment guide

## See Also

- [Factory Orchestrator README](./.factory/README.md)
- [Agent Responsibilities](#agent-responsibilities) in CLAUDE.md
- GitHub Workflows: `.github/workflows/factory-start.yml`
- CLI Reference: `.factory/cli.ts`
