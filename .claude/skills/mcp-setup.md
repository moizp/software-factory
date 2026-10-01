# MCP Setup Skill

Automated setup and validation of Model Context Protocol (MCP) servers for the software factory.

## Purpose

This skill coordinates MCP server installation, credential validation, and connection testing. Used by the MCP Configurator agent to prepare external tools for builder agents.

## When to Use

- Setting up a new project with external dependencies
- Configuring GitHub, Stripe, database, or other MCP servers
- Validating credentials before builders start
- Troubleshooting MCP connection issues

## Prerequisites

1. Claude Code installed: `npm install -g @anthropic-ai/claude-code`
2. `project.config.json` with `mcp_servers` section
3. `scripts/credentials.sh` with API keys set

## Quick Setup

```bash
# 1. Load credentials
source scripts/credentials.sh

# 2. Run setup script
./scripts/setup-mcp.sh

# 3. Validate connections
./scripts/validate-mcp.sh

# 4. Check status
claude mcp list
```

## What Gets Installed

Based on `project.config.json.mcp_servers`:

| Server | Type | Purpose |
|--------|------|---------|
| GitHub | Built-in | Source control, push code, create repos |
| PostgreSQL | Built-in | Database operations, migrations |
| Stripe | HTTP | Payment processing, product config |
| Slack | HTTP | Notifications, logging |
| Supabase | HTTP | Auth, realtime database |

## MCP Server Registry

Official MCP servers available:

```bash
# GitHub
claude mcp add github -- npx -y @modelcontextprotocol/server-github

# PostgreSQL
claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres \
  --host localhost --port 5432

# MongoDB
claude mcp add mongodb -- npx -y @modelcontextprotocol/server-mongodb

# Stripe
claude mcp add stripe --transport http stripe-mcp https://stripe-mcp.example.com

# Slack
claude mcp add slack --transport http slack-mcp https://slack-mcp.example.com
```

## Credential Requirements

### Required Credentials

These must be set before builders start:

- **GITHUB_TOKEN** — For code push/pull
  - Get from: https://github.com/settings/tokens
  - Scopes: `repo`, `workflow`, `admin:repo_hook`

- **DB_PASSWORD** — Database connection
  - Format: `postgres://user:password@host:port/db`
  - Or: `mongodb://user:password@host:port/db`

### Optional Credentials

These enable specific features:

- **STRIPE_MCP_KEY** — Payment processing
- **SLACK_BOT_TOKEN** — Team notifications
- **SUPABASE_KEY** — Auth & realtime

## Validation Process

MCP Configurator validates in this order:

1. **Environment Check** — Credentials exist and exported
2. **Endpoint Check** — HTTP servers are reachable
3. **Connection Test** — Each MCP server responds to tools list
4. **Permission Check** — Credentials have required scopes
5. **Tool Registration** — All tools available to builders

Example validation output:

```json
{
  "github": {
    "status": "ready",
    "tools": ["create_repository", "push_code", "create_pull_request"],
    "permissions": ["repo", "workflow"]
  },
  "postgres": {
    "status": "ready",
    "host": "localhost:5432",
    "database": "mydb",
    "tables": ["users", "sessions", "workspaces"]
  },
  "stripe": {
    "status": "ready",
    "environment": "test",
    "tools": ["create_product", "create_webhook"]
  }
}
```

## Troubleshooting

### "GITHUB_TOKEN not set"

```bash
# Ensure credentials loaded
source scripts/credentials.sh

# Verify it's set
echo $GITHUB_TOKEN

# If empty, edit and source again
nano scripts/credentials.sh
source scripts/credentials.sh
```

### "Cannot connect to PostgreSQL"

```bash
# Check if database is running
# For local development, start a container:
docker run --name postgres -e POSTGRES_PASSWORD=password \
  -p 5432:5432 -d postgres:15

# Update credentials with correct connection string
# Then re-run setup
```

### "Stripe MCP unreachable"

Stripe MCP is an external HTTP server. Verify:

1. Endpoint URL is correct
2. MCP server is running
3. Firewall allows connection
4. STRIPE_MCP_KEY is valid

```bash
# Test connectivity
curl https://stripe-mcp.example.com/health

# If fails, check with Stripe support or run local MCP server
```

### "MCP list shows no servers"

Claude Code isn't running or not in same shell session.

```bash
# Start Claude Code
claude

# In new shell or same session after export:
source scripts/credentials.sh
claude mcp list
```

## Adding New MCP Servers

To add a server not in the default config:

1. Update `project.config.json`:
```json
{
  "mcp_servers": {
    "new-service": {
      "type": "http",
      "endpoint": "https://new-service-mcp.example.com",
      "auth": "env:NEW_SERVICE_KEY"
    }
  }
}
```

2. Add credential to `scripts/credentials.sh`:
```bash
export NEW_SERVICE_KEY="api_key_here"
```

3. Run MCP Configurator to auto-register:
```bash
claude "Run mcp-configurator agent"
```

## Performance & Context

Each MCP server adds tools to Claude's system prompt, consuming context tokens:

| Server | Tokens | Mitigation |
|--------|--------|-----------|
| GitHub | ~2000 | Use when needed |
| PostgreSQL | ~1500 | Disable if using external DB |
| Stripe | ~1200 | Disable if no payments |
| Slack | ~800 | Disable for solo projects |

If context is tight:

```bash
# Remove unused servers
claude mcp remove slack
claude mcp remove supabase

# Verify remaining servers
claude mcp list
```

## Best Practices

1. **Load credentials first** — Always `source scripts/credentials.sh` before running factory
2. **Test connections** — Run `./scripts/validate-mcp.sh` before builders start
3. **Use test credentials** — For development, use Stripe test keys (`sk_test_...`)
4. **Monitor context** — Check `claude /context` if using many MCP servers
5. **Secure credentials** — Never commit `scripts/credentials.sh` (already gitignored)
6. **Rotate keys** — Regenerate API keys periodically in production
7. **Document setup** — Keep `docs/mcp-setup-guide.md` updated for team

## MCP Tools Reference

Once configured, these tools are available to builders:

### GitHub MCP

```typescript
// Create repository
create_repository({
  name: "my-saas-backend",
  description: "Backend API",
  private: true
})

// Push code
push_code({
  repository: "my-saas-backend",
  files: [...],
  message: "feat: add authentication"
})

// Create pull request
create_pull_request({
  repository: "my-saas-backend",
  title: "Add user endpoints",
  base: "main",
  head: "feature/users"
})
```

### PostgreSQL MCP

```typescript
// Execute query
execute_query({
  sql: "SELECT * FROM users WHERE email = $1",
  params: ["test@example.com"]
})

// Create schema from requirements
create_schema({
  entities: [
    { name: "users", fields: ["id", "email"] }
  ]
})

// Generate migration
generate_migration({
  name: "add_users_table",
  up: "CREATE TABLE users...",
  down: "DROP TABLE users"
})
```

### Stripe MCP

```typescript
// Create product
create_product({
  name: "Pro Plan",
  description: "Premium features"
})

// Create webhook
create_webhook({
  url: "https://myapi.com/webhooks/stripe",
  events: ["charge.succeeded", "invoice.payment_failed"]
})
```

## Integration with Factory

MCP Setup skill is called by:

1. **MCP Configurator Agent** — Validates & registers servers
2. **Builder Agents** — Use registered tools to generate code
3. **Manual workflow** — Run `./scripts/setup-mcp.sh` before starting

Flow:

```
Developer sets credentials
    ↓
./scripts/setup-mcp.sh
    ↓
MCP Configurator validates
    ↓
Builders access MCP tools
    ↓
Code is generated with external integrations
```

---

**Start here:** Copy credentials template, fill in real values, run setup script, validate. Then proceed to analyzer agent.
