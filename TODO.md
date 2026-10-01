# Software Factory TODO

## 🔴 CRITICAL: Real Agent Invoker Not Connected

**Status:** Orchestrator built but factory is not actually invoking real agents

- [ ] Fix `cli.ts` line 65 — Import and use `invokeClaudeAgent` instead of `mockAgentInvoker`
  - [ ] Test single agent invocation
  - Estimate: 1 hour

- [ ] Fix `run-workflow.ts` line 42 — Use real invoker
  - [ ] Verify GitHub Actions workflow actually runs agents
  - Estimate: 1 hour

- [ ] Complete `claude-bridge.ts`
  - [ ] Fix `invokeClaudeAgentViaApi()` (currently just throws error)
  - [ ] Validate `invokeClaudeAgentViaCli()` actually works with claude CLI
  - [ ] Add proper error handling for timeout/failures
  - [ ] Test JSON extraction robustness
  - Estimate: 3 hours

- [ ] Integrate logger into orchestrator
  - [ ] Replace `this.log()` with `this.logger.info/debug/error()`
  - Estimate: 1 hour

- [ ] Add agent validation
  - [ ] Verify agents return valid JSON before processing
  - [ ] Add schema validation for agent responses
  - Estimate: 2 hours

- [ ] Remove or deprecate `mockAgentInvoker`
  - [ ] Delete mock implementation after real invoker works
  - Estimate: 30 min

**Total: 8.5 hours** — BLOCKS ALL PRODUCTION USE

## 🚨 Critical Blockers (Must Fix Before Production)

### Claude Code Integration
- [ ] Create `.factory/claude-bridge.ts` — Bridge to invoke agents via Claude Code CLI
  - [ ] Implement `invokeClaudeAgent(agentName, context)` function
  - [ ] Parse agent output JSON from `.claude/agents/*.md` files
  - [ ] Handle agent timeouts and failures
  - [ ] Pass state/context between agents
  - Estimate: 4 hours

- [ ] Replace `mockAgentInvoker` with real implementation in `cli.ts`
  - [ ] Update `orchestrator.ts` to use actual agent invoker
  - [ ] Test with single agent invocation
  - Estimate: 2 hours

### GitHub Integration
- [ ] Create `.factory/github-integration.ts` — GitHub API wrapper
  - [ ] Create PR when workflow starts
  - [ ] Update PR status as phases complete
  - [ ] Auto-merge PR when workflow succeeds
  - [ ] Post failed phase details as PR comments
  - [ ] Use Octokit (add to dependencies)
  - Estimate: 6 hours

- [ ] Update `factory-start.yml` GitHub Actions workflow
  - [ ] Actually call orchestrator (not just mock)
  - [ ] Pass issue context to orchestrator
  - [ ] Report results back to GitHub
  - Estimate: 2 hours

### Validation & Setup
- [ ] Create `scripts/validate-setup.sh`
  - [ ] Check Node.js version
  - [ ] Verify all dependencies installed
  - [ ] Validate credentials exist (GITHUB_TOKEN, etc.)
  - [ ] Test MCP server connectivity
  - [ ] Verify agent files exist
  - Estimate: 2 hours

- [ ] Add pre-flight validation to orchestrator
  - [ ] Check all required MCP servers are registered
  - [ ] Validate project.config.json schema
  - [ ] Verify all agent files readable
  - Estimate: 2 hours

## 📋 High Priority (Needed for MVP)

### Error Handling & Recovery
- [ ] Implement retry logic in orchestrator
  - [ ] Configurable max retries per agent
  - [ ] Exponential backoff
  - [ ] Log retry attempts
  - Estimate: 3 hours

- [ ] Add failure notifications
  - [ ] Slack integration (when workflow fails)
  - [ ] GitHub status checks on every phase
  - [ ] Email summaries (optional)
  - Estimate: 3 hours

- [ ] Implement rollback mechanism
  - [ ] Save git state before each phase
  - [ ] Revert on critical failures
  - [ ] Document rollback process
  - Estimate: 4 hours

### Testing Infrastructure
- [ ] Create comprehensive test suite (`.factory/test.ts`)
  - [ ] Unit tests for state management
  - [ ] Unit tests for orchestrator logic
  - [ ] Integration tests for agent sequencing
  - [ ] Mock agent responses for realistic testing
  - [ ] Add to `npm test` script
  - Estimate: 6 hours

- [ ] Create test fixtures
  - [ ] Sample project.config.json variants
  - [ ] Mock agent outputs (sample JSON)
  - [ ] Test workflows for happy path + failure paths
  - Estimate: 2 hours

- [ ] Setup CI testing
  - [ ] Create `.github/workflows/factory-test.yml`
  - [ ] Run tests on every PR
  - [ ] Check coverage thresholds
  - Estimate: 2 hours

### Documentation
- [ ] Complete `docs/ORCHESTRATION.md`
  - [ ] Real agent invocation flow (not mock)
  - [ ] Troubleshooting guide for failures
  - [ ] Performance tuning (parallel execution)
  - [ ] Security considerations
  - [ ] Recovery procedures
  - Estimate: 4 hours

- [ ] Create `docs/IMPLEMENTATION.md`
  - [ ] How to run orchestrator locally
  - [ ] How to debug agent invocation
  - [ ] Common issues and fixes
  - Estimate: 2 hours

## 🔧 Medium Priority (Nice to Have)

### State Management Enhancement
- [ ] Add workflow cleanup
  - [ ] Archive completed workflows after 30 days
  - [ ] Compress old state files
  - [ ] Implement retention policy
  - Estimate: 3 hours

- [ ] Add state recovery
  - [ ] Detect incomplete workflows on startup
  - [ ] Resume from last successful phase
  - [ ] Add resume command to CLI
  - Estimate: 4 hours

- [ ] Add workflow analytics
  - [ ] Track execution time per phase
  - [ ] Measure success rate by agent
  - [ ] Generate reports
  - Estimate: 3 hours

### GitHub Deployment Integration
- [ ] Create `.github/workflows/factory-deploy.yml`
  - [ ] Auto-deploy on workflow success
  - [ ] Check deployment readiness
  - [ ] Rollback on deployment failure
  - Estimate: 4 hours

### Monitoring & Observability
- [ ] Add structured logging
  - [ ] JSON logs for parse-ability
  - [ ] Persist logs to `.factory/logs/`
  - [ ] Add log levels (DEBUG, INFO, WARN, ERROR)
  - Estimate: 2 hours

- [ ] Add metrics collection
  - [ ] Track workflow duration
  - [ ] Count phases by status
  - [ ] Export metrics to Prometheus (optional)
  - Estimate: 3 hours

## 🎯 New Features (Future)

### Additional Agents
- [ ] Add skeptical-reviewer agent
  - [ ] Review code for architectural issues
  - [ ] Challenge assumptions and design decisions
  - [ ] Find performance/security problems
  - [ ] Gate before final reviewer
  - See: `.claude/agents/skeptical-reviewer.md`

- [ ] Add compliance-checker agent
  - [ ] Verify GDPR/SOC2 requirements
  - [ ] Check license compatibility
  - [ ] Validate security headers
  - Estimate: 6 hours (future)

### Dashboard & UI
- [ ] Create web dashboard (optional)
  - [ ] Real-time workflow status
  - [ ] Phase details and logs
  - [ ] Retry workflows from UI
  - Estimate: 12+ hours (future)

### Advanced Orchestration
- [ ] Support conditional workflows
  - [ ] Skip phases based on config
  - [ ] Branch workflows (A/B testing)
  - Estimate: 8 hours (future)

- [ ] Add workflow templates
  - [ ] Save successful workflows as templates
  - [ ] Reuse for similar projects
  - Estimate: 4 hours (future)

---

## Metrics

| Category | Estimate | Status |
|----------|----------|--------|
| Critical Blockers | 20 hours | 🚨 Not Started |
| High Priority | 24 hours | 🚨 Not Started |
| Medium Priority | 17 hours | ⏸️ Future |
| Features | 26+ hours | ⏸️ Future |
| **TOTAL MVP** | **44 hours** | **🚨 In Progress** |

## Next Steps

1. **Implement Claude bridge** (`.factory/claude-bridge.ts`) — This unblocks everything
2. **Add GitHub integration** — Required for autonomous workflows
3. **Setup validation** — Prevent broken deployments
4. **Create test suite** — Verify orchestrator works
5. **Add error handling** — Make it production-ready

Start with items marked 🚨 before any others.
