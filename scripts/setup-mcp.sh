#!/bin/bash

# MCP Server Setup Script
# Automatically configures MCP servers based on project.config.json

set -e  # Exit on error

echo "🚀 Setting up MCP servers..."
echo ""

# Check if credentials are loaded
if [ -z "$GITHUB_TOKEN" ]; then
    echo "⚠️  Warning: GITHUB_TOKEN not set"
    echo "   Run: source scripts/credentials.sh"
fi

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track success/failure
SERVERS_CONFIGURED=0
SERVERS_FAILED=0

# Function to add MCP server
add_server() {
    local name=$1
    local command=$2
    
    echo -n "Configuring $name MCP... "
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Configured"
        ((SERVERS_CONFIGURED++))
    else
        echo -e "${RED}✗${NC} Failed"
        ((SERVERS_FAILED++))
    fi
}

# Add built-in servers
echo "📦 Configuring built-in servers..."

if command -v claude &> /dev/null; then
    add_server "GitHub" "claude mcp add github -- npx -y @modelcontextprotocol/server-github"
    
    add_server "PostgreSQL" "claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres --host localhost --port 5432"
else
    echo -e "${RED}✗ Claude Code not installed${NC}"
    echo "   Install: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Add HTTP-based servers (if needed)
echo ""
echo "🌐 Configuring HTTP servers (if credentials available)..."

if [ ! -z "$STRIPE_MCP_KEY" ]; then
    add_server "Stripe" "claude mcp add stripe --transport http stripe-mcp https://stripe-mcp.example.com"
fi

if [ ! -z "$SLACK_BOT_TOKEN" ]; then
    add_server "Slack" "claude mcp add slack --transport http slack-mcp https://slack-mcp.example.com"
fi

if [ ! -z "$SUPABASE_KEY" ]; then
    add_server "Supabase" "claude mcp add supabase --transport http supabase-mcp https://supabase-mcp.example.com"
fi

# Verify setup
echo ""
echo "✅ Verifying MCP connections..."
echo ""

if command -v claude &> /dev/null; then
    claude mcp list || echo -e "${YELLOW}⚠️  Could not verify servers (Claude Code might not be running)${NC}"
fi

# Summary
echo ""
echo "📊 Setup Summary:"
echo "  Configured: $SERVERS_CONFIGURED"
echo "  Failed: $SERVERS_FAILED"
echo ""

if [ $SERVERS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ MCP setup complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run: ./scripts/validate-mcp.sh"
    echo "2. Start Claude Code: claude"
    echo "3. Begin factory workflow: claude 'Execute complete factory workflow'"
    exit 0
else
    echo -e "${RED}⚠️  Some servers failed to configure${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check credentials: source scripts/credentials.sh"
    echo "2. Verify Claude Code: claude --version"
    echo "3. Check MCP servers: claude mcp list"
    echo "4. Read: docs/mcp-setup-guide.md"
    exit 1
fi
