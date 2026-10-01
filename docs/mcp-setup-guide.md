# MCP Setup Guide

Complete reference for configuring Model Context Protocol (MCP) servers for the software factory.

## Quick Start

```bash
# 1. Set up credentials
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit credentials.sh with real API keys

# 2. Load credentials
source scripts/credentials.sh

# 3. Run setup
./scripts/setup-mcp.sh

# 4. Validate
./scripts/validate-mcp.sh

# 5. Start factory
claude "Execute complete factory workflow"
```

## Prerequisites

### Required Software

- **Claude Code** — Install: `npm install -g @anthropic-ai/claude-code`
- **Node.js** — v18+
- **npm** or **pnpm**
- **Git** — v2.0+

Verify installation:

```bash
claude --version
node --version
npm --version
git --version
```

### Required Credentials

You'll need API keys for:

1. **GitHub** — Source control
2. **PostgreSQL** (or supported DB) — Data persistence
3. **Stripe** — Payments (optional but recommended)
4. **Slack** — Notifications (optional)
5. **Supabase** — Auth/realtime (optional)

## Detailed Setup

### Step 1: GitHub Token

Create a Personal Access Token:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - ✅ `repo` — Full control of repositories
   - ✅ `workflow` — Update GitHub workflows
   - ✅ `admin:repo_hook` — Access webhooks
4. Copy token (you won't see it again)
5. Add to `scripts/credentials.sh`:

```bash
export GITHUB_TOKEN="ghp_YOUR_TOKEN_HERE"
```

### Step 2: Database

#### PostgreSQL (Recommended)

Option A: Local development

```bash
# Install PostgreSQL
brew install postgresql  # macOS
# OR
sudo apt-get install postgresql  # Linux

# Start server
brew services start postgresql  # macOS

# Create database
createdb mydb

# Get connection string
echo "postgres://postgres:password@localhost:5432/mydb"
```

Option B: Docker container

```bash
docker run --name postgres -e POSTGRES_PASSWORD=password \
  -p 5432:5432 -d postgres:15

# Wait for startup, then test
docker exec postgres psql -U postgres -c "SELECT version();"
```

Add to `scripts/credentials.sh`:

```bash
export DB_PASSWORD="postgres://postgres:password@localhost:5432/mydb"
```

#### Alternative: Render.com (Hosted)

1. Create account: https://render.com
2. Create PostgreSQL database
3. Copy connection string
4. Add to credentials.sh

### Step 3: Stripe (Payments)

1. Create account: https://stripe.com
2. Go to Dashboard → API Keys
3. Copy test secret key (`sk_test_...`)
4. Add to `scripts/credentials.sh`:

```bash
export STRIPE_MCP_KEY="sk_test_YOUR_TEST_KEY"
```

**Note:** Never use live keys for development. Stripe test keys start with `sk_test_`.

### Step 4: Optional Services

#### Slack

1. Create Workspace: https://slack.com/create
2. Go to https://api.slack.com/apps
3. Create New App → From scratch
4. Name: "MySaaS Bot"
5. Copy Bot User OAuth Token (`xoxb-...`)
6. Add to `scripts/credentials.sh`:

```bash
export SLACK_BOT_TOKEN="xoxb_YOUR_BOT_TOKEN"
```

#### Supabase

1. Create project: https://supabase.com
2. Go to Project Settings → API
3. Copy `anon public` key
4. Add to `scripts/credentials.sh`:

```bash
export SUPABASE_KEY="eyJhbGciOiJIUzI1..."
```

## Configuration

### project.config.json

Customize which MCP servers your project needs:

```json
{
  "mcp_servers": {
    "github": {
      "type": "built-in",
      "required": true
    },
    "postgres": {
      "type": "postgres",
      "required": true,
      "config": {
        "host": "localhost",
        "port": 5432
      }
    },
    "stripe": {
      "type": "http",
      "required": true,
      "endpoint": "https://stripe-mcp.example.com"
    },
    "slack": {
      "type": "http",
      "required": false,
      "endpoint": "https://slack-mcp.example.com"
    }
  }
}
```

**Fields:**

- `type` — `built-in` | `http` | `postgres` | `mongodb`
- `required` — If `true`, factory won't proceed without it
- `endpoint` — For HTTP servers, the URL where MCP server runs
- `config` — Server-specific configuration

### Credentials File

```bash
#!/bin/bash
# scripts/credentials.sh (NEVER COMMIT THIS FILE)

# GitHub
export GITHUB_TOKEN="ghp_..."

# Database
export DB_PASSWORD="postgres://..."

# Payments
export STRIPE_MCP_KEY="sk_test_..."

# Optional
export SLACK_BOT_TOKEN="xoxb-..."
export SUPABASE_KEY="eyJ..."
```

**Security:**

- ✅ File is in `.gitignore` — can't be committed
- ✅ Use `source scripts/credentials.sh` to load before running factory
- ✅ Never share credentials in chat or email
- ✅ Rotate keys periodically
- ✅ Use test keys for development

## Running Setup

### Automated Setup

```bash
# Load credentials
source scripts/credentials.sh

# Run setup script (installs MCP servers)
./scripts/setup-mcp.sh

# Output:
# 🚀 Setting up MCP servers...
# Configuring GitHub MCP... ✓ Configured
# Configuring PostgreSQL MCP... ✓ Configured
# Configuring Stripe MCP... ✓ Configured
# ...
# ✅ MCP setup complete!
```

### Manual Setup

If automated script fails:

```bash
# Load credentials first
source scripts/credentials.sh

# Add each server manually
claude mcp add github -- npx -y @modelcontextprotocol/server-github

claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres \
  --host localhost --port 5432

claude mcp add stripe --transport http stripe-mcp https://stripe-mcp.example.com

# Verify
claude mcp list
```

### Validate Setup

```bash
# Check all servers are connected
./scripts/validate-mcp.sh

# Output:
# 🔍 Validating MCP server connections...
# 
# Configured MCP Servers:
# 
# GitHub MCP: ✓ Connected
# PostgreSQL MCP: ✓ Connected
# Stripe MCP: ✓ Connected
# Slack MCP: ⏭️  Not configured (optional)
# 
# Environment variables:
#   GITHUB_TOKEN: ✓ Set
#   DB_PASSWORD: ✓ Set
#   STRIPE_MCP_KEY: ✓ Set
# 
# ✅ All required MCP servers are connected!
```

## Troubleshooting

### "GITHUB_TOKEN not set"

```bash
# Check if credentials loaded
echo $GITHUB_TOKEN

# If empty, reload credentials
source scripts/credentials.sh

# If still empty, verify credentials.sh exists and has the export
cat scripts/credentials.sh | grep GITHUB_TOKEN
```

### "Cannot connect to PostgreSQL"

```bash
# Check if PostgreSQL is running
psql -h localhost -U postgres -c "SELECT 1;"

# If not running, start it
# macOS: brew services start postgresql
# Linux: sudo service postgresql start
# Docker: docker start postgres

# Verify connection string
psql "postgres://postgres:password@localhost:5432/mydb"
```

### "MCP server not found after setup"

```bash
# Verify Claude Code is running
claude

# In same session, check installed servers
claude mcp list

# If not listed, re-run setup
./scripts/setup-mcp.sh

# Check for errors
claude mcp add github -- npx -y @modelcontextprotocol/server-github 2>&1
```

### "HTTP MCP server unreachable"

For Stripe, Slack, Supabase MCPs:

```bash
# Test endpoint connectivity
curl https://stripe-mcp.example.com/health

# If fails:
# 1. Verify endpoint URL in project.config.json
# 2. Ensure MCP server is running
# 3. Check firewall/network settings
# 4. Verify auth key is correct

# Contact MCP provider for support
```

### "Out of context tokens"

If Claude Code reports high context usage:

```bash
# Check which servers consume tokens
claude /context

# Disable unused servers
claude mcp remove slack
claude mcp remove supabase

# Verify remaining servers
claude mcp list

# Re-check context
claude /context
```

## MCP Server Registry

### Built-in Servers (No Installation)

Just run:

```bash
claude mcp add <name> -- <command>
```

#### GitHub

```bash
claude mcp add github -- npx -y @modelcontextprotocol/server-github
```

Provides:
- Create/read/write repositories
- Create branches and pull requests
- Access repository files
- Query issues and discussions

#### PostgreSQL

```bash
claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres \
  --host localhost --port 5432
```

Provides:
- Execute SQL queries
- Inspect schema
- Generate migrations
- Execute raw SQL

### HTTP Servers (External Deployment)

These require the MCP server to be running externally:

```bash
claude mcp add <name> --transport http <name> <url>
```

#### Stripe MCP

Endpoint: `https://stripe-mcp.example.com`

Requires: `STRIPE_MCP_KEY` environment variable

Provides:
- Create products and prices
- Configure webhooks
- Query charges and customers
- Test mode operations

#### Slack MCP

Endpoint: `https://slack-mcp.example.com`

Requires: `SLACK_BOT_TOKEN` environment variable

Provides:
- Send messages
- Read channels
- Create threads
- Upload files

#### Supabase MCP

Endpoint: `https://supabase-mcp.example.com`

Requires: `SUPABASE_KEY` environment variable

Provides:
- Auth operations
- Realtime subscriptions
- Query database
- Upload storage

## Best Practices

### Development

- ✅ Use test API keys (Stripe `sk_test_...`)
- ✅ Use local PostgreSQL or docker
- ✅ Rotate credentials monthly
- ✅ Never commit `scripts/credentials.sh`
- ✅ Use separate keys per environment

### Production

- ✅ Use live keys only in production
- ✅ Store secrets in vault (not env vars)
- ✅ Restrict API key permissions (least privilege)
- ✅ Enable API key rotation
- ✅ Monitor API usage
- ✅ Set up webhook verification

### Team Collaboration

- ✅ Each developer has personal API keys
- ✅ Share only `project.config.json` (no secrets)
- ✅ Use `.env.template` as reference
- ✅ Document which MCP servers are required
- ✅ Test setup on new machines

### Monitoring

```bash
# Check MCP context usage
claude /context

# View recent MCP calls
claude mcp list

# Monitor API usage (provider dashboards)
# - GitHub: https://github.com/settings/billing/summary
# - Stripe: https://dashboard.stripe.com/developers/dashboard
# - Slack: https://api.slack.com/usage
```

## Next Steps

After setup:

1. ✅ Run `./scripts/validate-mcp.sh` to confirm all servers connected
2. ✅ Start Claude Code: `claude`
3. ✅ Run analyzer: `claude "Run analyzer agent"`
4. ✅ Follow factory workflow through architecture, builders, and review

See `README.md` for complete factory workflow.

## Support

- **Claude Code docs** — https://docs.anthropic.com/claude-code
- **MCP docs** — https://modelcontextprotocol.io
- **Troubleshooting** — Run `./scripts/validate-mcp.sh` and check output
- **Questions** — Review `CLAUDE.md` for orchestration details

---

**You're set!** All MCP servers are configured and ready for the software factory workflow. 🚀
