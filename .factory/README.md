# Factory Orchestrator

The orchestrator is the core engine that coordinates all agents in the software factory workflow. It manages state, executes phases sequentially and in parallel, and ensures validation gates are properly enforced.

## Architecture

```
User Issue (GitHub)
    ↓
[Factory Orchestrator]
    ├─ [Sequential] Product Manager
    ├─ [Sequential] Analyzer
    ├─ [Sequential] Architect
    ├─ [Parallel] Builders (Backend, Frontend, Infrastructure)
    ├─ [Parallel] Testers (Backend, Frontend, Infrastructure)
    ├─ [Sequential] E2E Tester
    ├─ [Sequential] Reviewer
    └─ [Sequential] Customer Support
```

## Components

### State Management (`state.ts`)

Manages workflow state persistence:

```typescript
WorkflowState {
  id: string                  // Unique workflow identifier
  issueBrief: string         // User's project requirement
  currentPhase: Phase        // Current execution phase
  status: 'running' | 'completed' | 'failed'
  phases: PhaseGate[]        // All executed phases with validation results
  artifacts: Artifact[]      // Generated code, designs, configs
  notes: string[]            // Workflow execution log
}
```

**Key functions:**
- `createWorkflowState()` - Initialize new workflow
- `saveWorkflowState()` - Persist to `.factory/workflows/{id}.json`
- `loadWorkflowState()` - Retrieve workflow by ID
- `updatePhase()` - Record phase completion and validation
- `addArtifact()` - Add generated output
- `addNote()` - Add execution log entry

### Orchestrator Engine (`orchestrator.ts`)

Executes the multi-phase workflow:

```typescript
class FactoryOrchestrator {
  async executeWorkflow(
    issueBrief: string,
    issueNumber?: number,
    config?: Record<string, unknown>
  ): Promise<WorkflowState>
}
```

**Execution flow:**

1. **Sequential phases** run one at a time
2. **Parallel phases** run simultaneously
3. **Validation gates** stop execution if a phase fails
4. **State persistence** after every phase
5. **Artifact collection** from each agent

### CLI Tool (`cli.ts`)

Command-line interface for workflow management:

```bash
npm run factory:start "Build feature X" 123
npm run factory:status wf-1234567890
npm run factory:list
npm run factory:watch wf-1234567890
npm run factory:retry wf-1234567890
```

## Workflow Phases

### 1. Product Manager (Sequential)
**Input:** User's issue brief  
**Output:** Refined requirements, feature list  
**Validation:** Confirms scope and feasibility

### 2. Analyzer (Sequential)
**Input:** Product Manager output  
**Output:** Technical requirements, MCP servers needed, database schema outline  
**Validation:** Confirms all MCP dependencies can be satisfied

### 3. Architect (Sequential)
**Input:** Analyzer output  
**Output:** System design, database schema, API contracts  
**Validation:** Confirms design is implementable

### 4. Builders (Parallel)
**Input:** Architect output  
**Output:** Actual code (Backend, Frontend, Infrastructure)  
**Validation:** Code compiles, passes linting

- **Backend Builder:** API, database migrations, business logic
- **Frontend Builder:** UI components, state management, styling
- **Infrastructure Builder:** Docker, Kubernetes, CI/CD configs

### 5. Testers (Parallel)
**Input:** Builder outputs  
**Output:** Unit tests, integration tests, test reports  
**Validation:** All tests pass, coverage >80%

- **Backend Tester:** API endpoint tests, database tests
- **Frontend Tester:** Component tests, E2E tests
- **Infrastructure Tester:** Deployment dry-runs, config validation

### 6. E2E Tester (Sequential)
**Input:** All builder + tester outputs  
**Output:** End-to-end test suite, success report  
**Validation:** Full system works as specified

### 7. Reviewer (Sequential)
**Input:** All artifacts  
**Output:** Security audit, code quality report  
**Validation:** No critical issues, code quality meets standards

### 8. Customer Support (Sequential)
**Input:** Final code, documentation  
**Output:** Deploy guide, API docs, user guides  
**Validation:** Complete documentation, deployment-ready

## State Persistence

Workflow state is saved to `.factory/workflows/{workflow-id}.json`:

```json
{
  "id": "wf-1704067200000-abc123def",
  "issueBrief": "Build user authentication system",
  "issueNumber": 123,
  "status": "running",
  "currentPhase": "backend-builder",
  "phases": [
    {
      "phase": "product-manager",
      "valid": true,
      "timestamp": "2024-01-01T10:00:00Z"
    },
    ...
  ],
  "artifacts": [
    {
      "phase": "architect",
      "type": "api-spec",
      "content": {...},
      "timestamp": "2024-01-01T10:05:00Z"
    },
    ...
  ]
}
```

## Error Handling

**Validation Gate Logic:**

```
Phase executes
  ↓
Returns: { valid: true/false, output, error? }
  ↓
Gate checks: valid === true?
  ├─ YES → Continue to next phase
  ├─ NO → Stop workflow, mark as 'failed'
  └─ Can retry from failed phase
```

**Retry Mechanism:**

```bash
npm run factory:retry wf-1704067200000-abc123def
```

Restarts from the first failed phase, preserving earlier artifacts.

## Testing

Run orchestrator tests:

```bash
npm run orchestrator:test
```

Tests cover:
- State creation and persistence
- Phase execution (sequential and parallel)
- Validation gate enforcement
- Artifact collection
- Error handling

## Monitoring

Track workflow in real-time:

```bash
npm run factory:watch wf-1704067200000-abc123def
```

Shows live updates of:
- Current phase
- Phase completion status
- Error messages
- Workflow status (running/completed/failed)

## Integration with GitHub

GitHub Actions trigger (`factory-start.yml`):

1. Listen for issues labeled "ready-to-build"
2. Create tracking PR
3. Invoke orchestrator
4. Post status updates to issue

## Extending the Orchestrator

### Add a new phase

1. Add phase name to `Phase` type in `state.ts`
2. Add execution in `executeWorkflow()` in `orchestrator.ts`
3. Choose sequential or parallel execution
4. Implement corresponding agent (`.claude/agents/`)

### Add a new agent

1. Create `.claude/agents/agent-name.md`
2. Define input/output JSON structure
3. Implement agent logic
4. Register in orchestrator workflow

## Configuration

Orchestrator reads from:
- `project.config.json` - Project settings
- `.factory/workflows/` - Workflow state files
- Environment variables - API keys, credentials

## Troubleshooting

**Workflow stuck?**
```bash
npm run factory:status wf-id
```

**Want to retry from failure?**
```bash
npm run factory:retry wf-id
```

**List all workflows?**
```bash
npm run factory:list
```

**Debug mode?**
Use `FactoryOrchestrator(invoker, verbose=true)` in code.
