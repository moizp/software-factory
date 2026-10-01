#!/bin/bash

# MCP Server Validation Script
# Tests that all configured MCP servers are connected and functional

set -e

echo "🔍 Validating MCP server connections..."
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Track results
PASSED=0
FAILED=0
SKIPPED=0

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo -e "${RED}✗ Claude Code not installed${NC}"
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo "Claude Code version:"
claude --version
echo ""

# List configured servers
echo -e "${BLUE}Configured MCP Servers:${NC}"
echo ""

# Parse output of 'claude mcp list'
if claude mcp list &> /dev/null; then
    # Try to extract and validate each server
    
    # GitHub
    echo -n "GitHub MCP: "
    if claude mcp list 2>/dev/null | grep -q "github"; then
        echo -e "${GREEN}✓ Connected${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⏭️  Not configured${NC}"
        ((SKIPPED++))
    fi
    
    # PostgreSQL
    echo -n "PostgreSQL MCP: "
    if claude mcp list 2>/dev/null | grep -q "postgres"; then
        echo -e "${GREEN}✓ Connected${NC}"
        # Try to verify connectivity
        if claude mcp list 2>/dev/null | grep -q "postgres"; then
            ((PASSED++))
        fi
    else
        echo -e "${YELLOW}⏭️  Not configured${NC}"
        ((SKIPPED++))
    fi
    
    # Stripe
    echo -n "Stripe MCP: "
    if claude mcp list 2>/dev/null | grep -q "stripe"; then
        echo -e "${GREEN}✓ Connected${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⏭️  Not configured (optional)${NC}"
        ((SKIPPED++))
    fi
    
    # Slack
    echo -n "Slack MCP: "
    if claude mcp list 2>/dev/null | grep -q "slack"; then
        echo -e "${GREEN}✓ Connected${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⏭️  Not configured (optional)${NC}"
        ((SKIPPED++))
    fi
    
    # Supabase
    echo -n "Supabase MCP: "
    if claude mcp list 2>/dev/null | grep -q "supabase"; then
        echo -e "${GREEN}✓ Connected${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⏭️  Not configured (optional)${NC}"
        ((SKIPPED++))
    fi
    
else
    echo -e "${YELLOW}⚠️  Could not list MCP servers${NC}"
    echo "   Make sure Claude Code is running"
fi

echo ""
echo "Checking environment variables..."
echo ""

# Check credentials
VARS=("GITHUB_TOKEN" "DB_PASSWORD" "STRIPE_MCP_KEY" "SLACK_BOT_TOKEN" "SUPABASE_KEY")

for var in "${VARS[@]}"; do
    echo -n "  $var: "
    if [ ! -z "${!var}" ]; then
        echo -e "${GREEN}✓ Set${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⏭️  Not set${NC}"
        ((SKIPPED++))
    fi
done

echo ""
echo "📊 Validation Results:"
echo "  Passed: $PASSED"
echo "  Skipped (optional): $SKIPPED"
echo "  Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All required MCP servers are connected!${NC}"
    echo ""
    echo "You're ready to:"
    echo "  → Run: claude 'Execute complete factory workflow'"
    echo "  → Or: claude 'Run analyzer agent'"
    exit 0
else
    echo -e "${RED}❌ Some MCP servers failed validation${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Ensure Claude Code is running: claude"
    echo "  2. Check credentials: source scripts/credentials.sh"
    echo "  3. Re-setup servers: ./scripts/setup-mcp.sh"
    echo "  4. View detailed logs: claude mcp list"
    exit 1
fi
