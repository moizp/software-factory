# Implementation Guide

How to run, debug, and troubleshoot the Software Factory orchestrator locally.

## Quick Start

### 1. Clone & Setup

```bash
git clone <repository> software-factory
cd software-factory
npm install
```

### 2. Configure Credentials

```bash
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit scripts/credentials.sh with real API keys:
# - GITHUB_TOKEN (generate from GitHub Settings)
# - DB_PASSWORD (PostgreSQL connection string)
# - STRIPE_MCP_KEY (Stripe API key)
# - SLACK_BOT_TOKEN (Slack workspace token)
```

### 3. Validate Setup

```bash
./scripts/validate-mcp.sh
# Outputs: ✅ All MCP servers ready
```

### 4. Start Workflow

**Option A: Via GitHub Issue (Recommended)**
```bash
# Create GitHub issue with project brief
# Label it with "ready-to-build"
# Orchestrator runs automatically!
```

**Option B: Manual CLI**
```bash
source scripts/credentials.sh
npm run factory:start "Build a user auth system" 42
```

## Running Orchestrator Locally

### Full Workflow

```bash
source scripts/credentials.sh
npm run factory:start "Build real-time chat" 123
npm run factory:watch wf-1704067200000-abc123
# Watch updates in real-time
```

### Single Agent (Debugging)

```bash
source scripts/credentials.sh

# Run only Product Manager
npm run factory:run product-manager --input='{"brief":"Build auth system"}'

# Run only Analyzer
npm run factory:run analyzer --input='{"requirements":{...}}'

# Run only Backend Engineer
npm run factory:run backend-engineer --input='{"schema":{...}}'
```

### Step-by-Step Phases

```bash
# Phase 1: Requirements
npm run factory:run product-manager --input='...' > phase1.json

# Phase 2: Tech Analysis
npm run factory:run analyzer --input="$(cat phase1.json)"

# Phase 3: Architecture (parallel)
npm run factory:run software-architect --input="$(cat phase2.json)" &
npm run factory:run platform-architect --input="$(cat phase2.json)" &
wait

# Phase 4: Builders (parallel, zero cost)
npm run factory:run backend-engineer --input="..." &
npm run factory:run frontend-engineer --input="..." &
npm run factory:run infrastructure-engineer --input="..." &
npm run factory:run automation-tester --input="..." &
npm run factory:run customer-support --input="..." &
wait
```

## Debugging Workflows

### View Workflow State

```bash
# Current status
npm run factory:status wf-1704067200000-abc123

# Pretty print state file
cat .factory/workflows/wf-1704067200000-abc123.json | jq '.'

# Show timeline
cat .factory/workflows/wf-id.json | jq '.timeline'

# Show errors
cat .factory/workflows/wf-id.json | jq '.phases[] | select(.valid==false)'
```

### Inspect Phase Output

```bash
# Get specific phase output
cat .factory/workflows/wf-id.json | jq '.phases[] | select(.phase=="backend-engineer")'

# Get all artifacts from phase
cat .factory/workflows/wf-id.json | jq '.artifacts[] | select(.phase=="architect")'

# Get error details
cat .factory/workflows/wf-id.json | jq '.phases[-1] | {phase, valid, error}'
```

### Trace Execution

```bash
# Enable verbose logging
DEBUG=factory:* npm run factory:start "Brief" 42

# Watch logs in real-time
tail -f .factory/workflows/wf-id.log

# View MCP server interactions
DEBUG=mcp:* npm run factory:run backend-engineer
```

### Debug Individual Agent

```bash
# Load agent file in isolation
cat .claude/agents/backend-engineer.md

# Test with minimal input
cat > test-input.json << 'EOF'
{
  "schema": { "tables": [...] },
  "openapi": { "paths": [...] }
}
EOF

npm run factory:run backend-engineer --input="$(cat test-input.json)" --verbose
```

## Common Issues & Fixes

### Issue 1: Missing Credentials

**Error:**
```
Error: GITHUB_TOKEN not in environment
```

**Fix:**
```bash
# Check if credentials.sh is sourced
echo $GITHUB_TOKEN

# If empty, source it
source scripts/credentials.sh

# Verify
echo $GITHUB_TOKEN  # Should print token, not empty
```

### Issue 2: MCP Server Won't Connect

**Error:**
```
Error: Cannot connect to Stripe MCP server
```

**Fix:**
```bash
# Validate MCP setup
./scripts/validate-mcp.sh

# Check individual server
claude mcp list | grep stripe

# Test connection directly
curl -H "Authorization: Bearer $STRIPE_MCP_KEY" https://stripe-mcp.example.com/health

# If endpoint is wrong, update project.config.json
```

### Issue 3: TypeScript Compilation Error in Builder

**Error:**
```
Error: Cannot find type 'User'
At backend-engineer phase
```

**Cause:** Architect didn't generate Prisma schema properly

**Fix:**
```bash
# Inspect architect output
cat .factory/workflows/wf-id.json | jq '.phases[] | select(.phase=="software-architect") | .output.prisma_schema'

# Retry architect phase only
npm run factory:retry wf-id --from-phase=software-architect

# Or manually fix Prisma schema and retry builder
npm run factory:retry wf-id --from-phase=backend-engineer
```

### Issue 4: Workflow Hung/No Progress

**Symptoms:** Status stays "running" but no phase updates

**Fix:**
```bash
# Check current phase and timestamp
npm run factory:status wf-id | grep -E "currentPhase|updatedAt"

# If >10 minutes old with no update, kill and retry
npm run factory:kill wf-id

# Restart from last passing phase
npm run factory:retry wf-id
```

### Issue 5: GitHub Actions Workflow Failed

**Error in GitHub:**
```
GitHub Actions: workflow_run failed
```

**Debug:**
```bash
# View Actions log
gh run view <run-id> --log

# Check if issue has "ready-to-build" label
gh issue view 42 --json labels

# Check if credentials are in GitHub Secrets
gh secret list | grep GITHUB_TOKEN
```

### Issue 6: Not Enough Disk Space

**Error:**
```
Error: ENOSPC: no space left on device
```

**Fix:**
```bash
# Check available space
df -h

# Clean old workflows
rm -rf .factory/workflows/wf-*-old

# Clear node_modules if needed
rm -rf node_modules && npm install
```

### Issue 7: Credentials Expired

**Error:**
```
Error: Invalid credentials: STRIPE_MCP_KEY expired
```

**Fix:**
```bash
# Regenerate API key in service
# E.g., Stripe dashboard → API Keys → create new

# Update credentials.sh
export STRIPE_MCP_KEY="sk_test_newkey..."

# Source and retry
source scripts/credentials.sh
npm run factory:retry wf-id
```

## Environment Setup Checklist

- [ ] Node.js 18+ installed
  ```bash
  node --version  # Should be v18.0.0+
  ```

- [ ] npm installed
  ```bash
  npm --version  # Should be 9+
  ```

- [ ] Repository cloned
  ```bash
  git clone <repo>
  ```

- [ ] Dependencies installed
  ```bash
  npm install
  ```

- [ ] Credentials configured
  ```bash
  cp scripts/credentials.sh.template scripts/credentials.sh
  # Edit with real keys
  source scripts/credentials.sh
  ```

- [ ] MCP servers validated
  ```bash
  ./scripts/validate-mcp.sh
  # All servers should show ✅
  ```

- [ ] project.config.json updated
  ```bash
  # Edit with your project details
  cat project.config.json | jq '.name'  # Should show your project
  ```

- [ ] GitHub token has permissions
  ```bash
  # Should have: repo, workflow, read:org
  gh auth status
  ```

- [ ] PostgreSQL accessible (if using)
  ```bash
  psql "$DB_PASSWORD" -c "SELECT version();"
  ```

- [ ] Stripe key valid (if needed)
  ```bash
  curl -H "Authorization: Bearer $STRIPE_MCP_KEY" https://api.stripe.com/v1/account
  ```

- [ ] Docker available (for infrastructure phase)
  ```bash
  docker --version
  ```

- [ ] test CLI works
  ```bash
  npm run factory:list  # Should show active workflows or empty
  ```

## Advanced Debugging

### Enable All Debug Logging

```bash
DEBUG=factory:*,mcp:*,orchestrator:* npm run factory:start "Brief" 42
```

### Profile Agent Performance

```bash
# Measure time for each phase
npm run factory:start "Brief" 42 --profile

# Shows:
# Phase product-manager: 2.3s
# Phase analyzer: 3.1s
# Phase architects: 5.0s (parallel)
# Phase builders: 12.5s (parallel)
```

### Inspect Generated Code

```bash
# After workflow completes, check generated files
find .factory/workflows/wf-id -name "*.ts" -o -name "*.json" | head -20

# View backend code
cat .factory/workflows/wf-id/backend/src/server.ts

# View database schema
cat .factory/workflows/wf-id/schema.prisma

# View API spec
cat .factory/workflows/wf-id/openapi.json | jq '.paths'
```

### Test Generated Code

```bash
# Install generated backend dependencies
cd .factory/workflows/wf-id/backend && npm install

# Run generated backend tests
npm test

# Check coverage
npm run coverage

# Lint generated code
npm run lint
```

## Recovery & Cleanup

### Restart From Failure

```bash
# If phase N failed, restart from phase N
npm run factory:retry wf-id

# Or start from specific phase
npm run factory:retry wf-id --from-phase=backend-engineer
```

### Clean Failed Workflow

```bash
# Remove workflow state
rm .factory/workflows/wf-id.json

# Clean generated artifacts
rm -rf .factory/workflows/wf-id/

# Start fresh
npm run factory:start "Brief" 42
```

### Archive Old Workflows

```bash
# Move old workflows to archive
mkdir -p .factory/archive
mv .factory/workflows/wf-*-$(date +%Y-%m-%d) .factory/archive/

# List archived
ls .factory/archive/
```

## Performance Monitoring

### Track Workflow Metrics

```bash
# Save metrics after each workflow
npm run factory:start "Brief" 42 --metrics

# Generates: .factory/metrics/wf-id.json
# Shows: phase times, token usage, artifact sizes
```

### Compare Workflows

```bash
# Compare performance across builds
npm run factory:metrics compare wf-1 wf-2 wf-3

# Shows: which phases are slowest, which consume most tokens
```

## Next Steps

- Review **ORCHESTRATION.md** for workflow details
- Check **CONFIGURATION.md** for schema reference
- See **.claude/CLAUDE.md** for agent responsibilities
- Visit **.factory/README.md** for orchestrator components

