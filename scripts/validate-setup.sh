#!/bin/bash

# Validation and setup verification script for software factory orchestrator
# Checks: Node.js version, dependencies, credentials, MCP connectivity, agent files

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0
PASSED=0

# Helper functions
log_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

echo "=================================================="
echo "  Software Factory Setup Validation"
echo "=================================================="
echo ""

# 1. Check Node.js version (>=18)
echo "Checking Node.js version..."
if ! command -v node &> /dev/null; then
    log_fail "Node.js is not installed"
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        log_pass "Node.js $(node -v) installed (>= 18 required)"
    else
        log_fail "Node.js version $(node -v) < 18 (>= 18 required)"
    fi
fi
echo ""

# 2. Verify dependencies installed
echo "Checking npm dependencies..."
if [ ! -d "node_modules" ]; then
    log_fail "node_modules directory not found - run 'npm install'"
else
    if npm list &> /dev/null; then
        log_pass "All npm dependencies installed"
    else
        log_fail "Some npm dependencies are missing - run 'npm install'"
    fi
fi
echo ""

# 3. Check credentials exist in environment
echo "Checking environment credentials..."
REQUIRED_CREDS=("GITHUB_TOKEN" "DB_PASSWORD" "STRIPE_MCP_KEY")
MISSING_CREDS=()

for cred in "${REQUIRED_CREDS[@]}"; do
    if [ -z "${!cred}" ]; then
        MISSING_CREDS+=("$cred")
    fi
done

if [ ${#MISSING_CREDS[@]} -eq 0 ]; then
    log_pass "All required credentials found in environment"
else
    log_fail "Missing credentials: ${MISSING_CREDS[*]}"
    log_info "Fix: source scripts/credentials.sh or set environment variables:"
    for cred in "${MISSING_CREDS[@]}"; do
        echo "     export $cred=<value>"
    done
fi
echo ""

# 4. Test MCP connectivity
echo "Checking MCP servers..."
if ! command -v claude &> /dev/null; then
    log_warn "Claude CLI not found - skipping MCP connectivity check"
else
    if claude mcp list &> /dev/null; then
        MCP_COUNT=$(claude mcp list | wc -l)
        log_pass "MCP servers configured ($MCP_COUNT registered)"
    else
        log_warn "Could not list MCP servers - check 'claude mcp list'"
    fi
fi
echo ""

# 5. Verify all agent files exist and are readable
echo "Checking agent files..."
AGENT_FILES=(
    ".claude/agents/product-manager.md"
    ".claude/agents/analyzer.md"
    ".claude/agents/mcp-configurator.md"
    ".claude/agents/software-architect.md"
    ".claude/agents/platform-architect.md"
    ".claude/agents/ui-designer.md"
    ".claude/agents/backend-engineer.md"
    ".claude/agents/frontend-engineer.md"
    ".claude/agents/infrastructure-engineer.md"
    ".claude/agents/automation-tester.md"
    ".claude/agents/e2e-tester.md"
    ".claude/agents/customer-support.md"
    ".claude/agents/reviewer.md"
)

MISSING_AGENTS=()
for agent_file in "${AGENT_FILES[@]}"; do
    if [ -f "$agent_file" ]; then
        if [ -r "$agent_file" ]; then
            :
        else
            MISSING_AGENTS+=("$agent_file (not readable)")
        fi
    else
        MISSING_AGENTS+=("$agent_file (not found)")
    fi
done

if [ ${#MISSING_AGENTS[@]} -eq 0 ]; then
    log_pass "All ${#AGENT_FILES[@]} agent files found and readable"
else
    log_fail "Missing or unreadable agent files: ${#MISSING_AGENTS[@]}"
    for agent in "${MISSING_AGENTS[@]}"; do
        echo "     - $agent"
    done
fi
echo ""

# 6. Verify project.config.json
echo "Checking project configuration..."
if [ ! -f "project.config.json" ]; then
    log_fail "project.config.json not found"
else
    if [ -r "project.config.json" ]; then
        if command -v jq &> /dev/null; then
            if jq empty project.config.json 2>/dev/null; then
                log_pass "project.config.json is valid JSON"
            else
                log_fail "project.config.json contains invalid JSON"
            fi
        else
            log_pass "project.config.json exists (jq not available for detailed check)"
        fi
    else
        log_fail "project.config.json not readable"
    fi
fi
echo ""

# 7. Verify orchestrator.ts compiles
echo "Checking TypeScript compilation..."
if ! command -v tsc &> /dev/null; then
    log_warn "TypeScript compiler not found - install with 'npm install'"
else
    if npm run build &> /dev/null; then
        log_pass "TypeScript compiles successfully"
    else
        log_fail "TypeScript compilation errors found - run 'npm run build'"
    fi
fi
echo ""

# Summary
echo "=================================================="
echo "  Validation Summary"
echo "=================================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! Ready to run factory.${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Please fix issues above.${NC}"
    exit 1
fi
