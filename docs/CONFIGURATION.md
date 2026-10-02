# Configuration Reference

Complete schema and setup guide for project.config.json, MCP servers, and environment variables.

## project.config.json Schema

### Root Level

```json
{
  "name": "string (required)",
  "description": "string",
  "type": "saas|web-app|api|monorepo (required)",
  "stack": "ts-react-node|py-fastapi|go-gin|custom (required)",
  "features": ["string (required)"],
  "mcp_servers": { /* see below */ },
  "backend": { /* see below */ },
  "frontend": { /* see below */ },
  "infrastructure": { /* see below */ },
  "deployment": { /* see below */ },
  "product": { /* see below */ },
  "design": { /* see below */ },
  "testing": { /* see below */ },
  "deployment_config": { /* see below */ },
  "support": { /* see below */ }
}
```

### Project Identity

```json
{
  "name": "MySaaS",
  "description": "Multi-tenant SaaS for team collaboration",
  "type": "saas",
  "stack": "ts-react-node"
}
```

**Valid `type` values:**
- `saas` — Software-as-a-Service (subscription model)
- `web-app` — Public web application
- `api` — REST/GraphQL API
- `monorepo` — Multiple packages

**Valid `stack` values:**
- `ts-react-node` — TypeScript + React + Express/Node.js
- `ts-react-fastapi` — TypeScript + React + Python FastAPI
- `ts-react-go` — TypeScript + React + Go (Gin)
- `py-django` — Python Django
- `go-htmx` — Go + HTMX
- `custom` — Specify all components manually

### Features List

```json
{
  "features": [
    "user-auth",
    "multi-tenant",
    "payments",
    "real-time-sync",
    "api",
    "admin-dashboard",
    "notifications",
    "search",
    "file-upload"
  ]
}
```

**Common features:**
- `user-auth` — User registration, login, password reset
- `multi-tenant` — Tenant isolation, workspaces
- `payments` — Stripe/payment processing
- `real-time-sync` — WebSockets, live updates
- `api` — Public REST/GraphQL API
- `admin-dashboard` — Admin panel for management
- `notifications` — Email, Slack, push notifications
- `search` — Full-text search
- `file-upload` — User file uploads
- `2fa` — Two-factor authentication
- `oauth` — Third-party OAuth (Google, GitHub)

### MCP Servers Configuration

```json
{
  "mcp_servers": {
    "github": {
      "type": "built-in|http|postgres|webhook",
      "required": true,
      "description": "Version control and CI/CD",
      "config": {
        "token": "env:GITHUB_TOKEN"
      }
    },
    "postgres": {
      "type": "postgres",
      "required": true,
      "description": "Primary database",
      "config": {
        "host": "localhost",
        "port": 5432,
        "database": "mydb",
        "auth": "env:DB_PASSWORD"
      }
    },
    "stripe": {
      "type": "http",
      "required": true,
      "description": "Payment processing",
      "endpoint": "https://stripe-mcp.example.com",
      "auth": "env:STRIPE_MCP_KEY"
    },
    "slack": {
      "type": "http",
      "required": false,
      "description": "Team notifications",
      "endpoint": "https://slack-mcp.example.com",
      "auth": "env:SLACK_BOT_TOKEN"
    }
  }
}
```

**Server Types:**
- `built-in` — Claude Code native servers (GitHub)
- `http` — HTTP/REST MCP servers
- `postgres` — PostgreSQL database
- `webhook` — Incoming webhooks

**Required vs Optional:**
- `required: true` — Workflow fails if missing
- `required: false` — Workflow skips if missing (features disabled)

### Backend Configuration

```json
{
  "backend": {
    "language": "typescript|python|go|rust",
    "runtime": "node|python|go|deno",
    "framework": "express|fastapi|gin|axum",
    "database": "postgres|mysql|mongodb",
    "orm": "prisma|sqlalchemy|gorm|sqlx",
    "auth": "jwt|oauth|sessions|supabase",
    "api_style": "rest|graphql|grpc"
  }
}
```

**Recommended Combinations:**
```json
// Node.js + Express + Prisma (recommended)
{ "language": "typescript", "runtime": "node", "framework": "express", "orm": "prisma" }

// Python + FastAPI + SQLAlchemy
{ "language": "python", "runtime": "python", "framework": "fastapi", "orm": "sqlalchemy" }

// Go + Gin + GORM
{ "language": "go", "runtime": "go", "framework": "gin", "orm": "gorm" }
```

### Frontend Configuration

```json
{
  "frontend": {
    "framework": "react|vue|svelte|angular",
    "language": "typescript|javascript",
    "styling": "tailwind|styled-components|css-in-js",
    "state_management": "tanstack-query|zustand|redux|pinia",
    "build_tool": "vite|webpack|next"
  }
}
```

**Recommended Setup:**
```json
{
  "framework": "react",
  "language": "typescript",
  "styling": "tailwind",
  "state_management": "tanstack-query",
  "build_tool": "vite"
}
```

### Infrastructure Configuration

```json
{
  "infrastructure": {
    "container": "docker|none",
    "orchestration": "none|kubernetes|docker-swarm",
    "hosting": "vercel|netlify|aws|gcp|digitalocean",
    "database_hosting": "managed|self-hosted|render-postgres",
    "cdn": "cloudflare|aws-cloudfront"
  }
}
```

**Hosting Options:**
- `vercel` — Frontend + serverless functions (Node.js)
- `netlify` — Frontend + functions
- `aws` — EC2, ECS, Lambda
- `gcp` — App Engine, Cloud Run
- `digitalocean` — Droplets, App Platform
- `railway` — PaaS for full stack

### Deployment Configuration

```json
{
  "deployment": {
    "ci_cd": "github-actions|gitlab-ci|circleci",
    "environments": ["dev", "staging", "production"],
    "monitoring": "datadog|newrelic|cloudwatch",
    "logging": "datadog|splunk|cloudwatch"
  }
}
```

### Product Configuration

```json
{
  "product": {
    "vision": "string",
    "tagline": "string",
    "target_users": "string",
    "market_segment": "B2B|B2C|D2C",
    "success_metrics": ["string"]
  }
}
```

**Example:**
```json
{
  "vision": "Simplify team collaboration with real-time tools",
  "tagline": "The all-in-one workspace for modern teams",
  "target_users": "Small teams and enterprises",
  "market_segment": "B2B SaaS",
  "success_metrics": [
    "1000 active users in month 1",
    "50% feature adoption",
    "$10K MRR by month 3"
  ]
}
```

### Design Configuration

```json
{
  "design": {
    "design_system": "Material|Custom|Bootstrap",
    "accessibility_target": "WCAG 2.1 AA|WCAG 2.1 AAA",
    "responsive_breakpoints": ["string"],
    "dark_mode": true
  }
}
```

**Example:**
```json
{
  "design_system": "Custom (Tailwind CSS)",
  "accessibility_target": "WCAG 2.1 AA",
  "responsive_breakpoints": [
    "mobile: <640px",
    "tablet: 640-1024px",
    "desktop: >1024px"
  ],
  "dark_mode": true
}
```

### Testing Configuration

```json
{
  "testing": {
    "unit_coverage_target": 70,
    "integration_coverage_target": "critical paths",
    "e2e_scenarios": ["string"],
    "browsers_to_test": ["Chrome", "Firefox", "Safari", "Edge"],
    "devices_to_test": ["Desktop", "Tablet", "Mobile"]
  }
}
```

### Deployment Config (Advanced)

```json
{
  "deployment_config": {
    "auto_scaling": {
      "enabled": true,
      "min_instances": 1,
      "max_instances": 5,
      "cpu_threshold_percent": 70
    },
    "multi_region": false,
    "backup_strategy": "Daily automated backups, 7-day retention",
    "disaster_recovery": {
      "rto_minutes": 30,
      "rpo_hours": 1
    }
  }
}
```

### Support Configuration

```json
{
  "support": {
    "documentation_format": "Markdown|HTML|PDF",
    "help_center_enabled": true,
    "faq_count_target": 20,
    "api_documentation": "OpenAPI 3.0|AsyncAPI",
    "onboarding_emails": 4,
    "support_channels": ["email", "help_center", "community_forum"]
  }
}
```

## Environment Variables

### Required for All Workflows

```bash
# GitHub
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
# Generate at: https://github.com/settings/tokens
# Scopes: repo, workflow, read:org

# Database (if using PostgreSQL)
export DB_PASSWORD="postgres://user:password@localhost:5432/mydb"
```

### Optional by Feature

```bash
# Payments (if "payments" feature enabled)
export STRIPE_MCP_KEY="sk_test_xxxxxxxx"
# Get from: https://dashboard.stripe.com/apikeys

# Chat/Notifications (if Slack integration needed)
export SLACK_BOT_TOKEN="xoxb-xxxxxxxxxxxxx"
# Get from: https://api.slack.com/apps

# Real-time Database (if using Supabase)
export SUPABASE_KEY="eyJhbGc..."
# Get from: https://app.supabase.com

# Analytics (if using Datadog)
export DATADOG_API_KEY="dd_xxxxx"
# Get from: https://app.datadoghq.com

# Email (if using SendGrid)
export SENDGRID_API_KEY="SG.xxxxx"
# Get from: https://app.sendgrid.com
```

### Runtime Environment Variables (in .env)

```bash
# Node.js
NODE_ENV=development
PORT=3000
DATABASE_URL=$DB_PASSWORD

# Frontend
VITE_API_URL=http://localhost:3000/api
VITE_PUBLIC_STRIPE_KEY=$STRIPE_PUBLIC_KEY

# Authentication
JWT_SECRET=your-secret-key-here
SESSION_SECRET=your-session-secret

# Feature Flags
ENABLE_PAYMENTS=true
ENABLE_REAL_TIME=true
ENABLE_NOTIFICATIONS=true
```

## Setup Examples

### Example 1: Simple Web App (No Auth)

```json
{
  "name": "BlogApp",
  "type": "web-app",
  "stack": "ts-react-node",
  "features": ["content-management", "search"],
  
  "mcp_servers": {
    "github": {
      "type": "built-in",
      "required": true,
      "config": { "token": "env:GITHUB_TOKEN" }
    },
    "postgres": {
      "type": "postgres",
      "required": true,
      "config": {
        "host": "localhost",
        "auth": "env:DB_PASSWORD"
      }
    }
  },
  
  "backend": {
    "language": "typescript",
    "framework": "express",
    "orm": "prisma",
    "api_style": "rest"
  },
  
  "frontend": {
    "framework": "react",
    "language": "typescript",
    "styling": "tailwind"
  },
  
  "testing": {
    "unit_coverage_target": 70,
    "browsers_to_test": ["Chrome", "Firefox"]
  }
}
```

**Credentials:**
```bash
export GITHUB_TOKEN="ghp_..."
export DB_PASSWORD="postgres://localhost/blog"
```

### Example 2: SaaS with Payments

```json
{
  "name": "ProjectManager",
  "type": "saas",
  "stack": "ts-react-node",
  "features": [
    "user-auth",
    "multi-tenant",
    "payments",
    "real-time-sync",
    "api",
    "notifications"
  ],
  
  "mcp_servers": {
    "github": {
      "type": "built-in",
      "required": true,
      "config": { "token": "env:GITHUB_TOKEN" }
    },
    "postgres": {
      "type": "postgres",
      "required": true,
      "config": { "auth": "env:DB_PASSWORD" }
    },
    "stripe": {
      "type": "http",
      "required": true,
      "endpoint": "https://stripe-mcp.example.com",
      "auth": "env:STRIPE_MCP_KEY"
    },
    "slack": {
      "type": "http",
      "required": false,
      "endpoint": "https://slack-mcp.example.com",
      "auth": "env:SLACK_BOT_TOKEN"
    }
  },
  
  "backend": {
    "language": "typescript",
    "framework": "express",
    "orm": "prisma",
    "auth": "jwt"
  },
  
  "infrastructure": {
    "hosting": "vercel",
    "database_hosting": "render-postgres"
  },
  
  "deployment": {
    "ci_cd": "github-actions",
    "environments": ["dev", "staging", "production"],
    "monitoring": "datadog"
  }
}
```

**Credentials:**
```bash
export GITHUB_TOKEN="ghp_..."
export DB_PASSWORD="postgres://render-db/projectmgr"
export STRIPE_MCP_KEY="sk_test_..."
export SLACK_BOT_TOKEN="xoxb-..."
```

### Example 3: Python FastAPI Backend

```json
{
  "name": "DataAPI",
  "type": "api",
  "stack": "py-fastapi",
  "features": ["user-auth", "api", "search"],
  
  "backend": {
    "language": "python",
    "runtime": "python",
    "framework": "fastapi",
    "orm": "sqlalchemy",
    "auth": "jwt"
  },
  
  "infrastructure": {
    "hosting": "aws",
    "database_hosting": "managed"
  },
  
  "testing": {
    "unit_coverage_target": 80,
    "integration_coverage_target": "critical paths"
  }
}
```

## MCP Server Setup Guide

### GitHub

**Already configured in Claude Code.**

```json
{
  "github": {
    "type": "built-in",
    "required": true,
    "config": { "token": "env:GITHUB_TOKEN" }
  }
}
```

**Setup:**
```bash
# Generate token
# 1. Visit: https://github.com/settings/tokens/new
# 2. Select scopes: repo, workflow, read:org
# 3. Generate and copy token
# 4. Add to credentials.sh:
export GITHUB_TOKEN="ghp_xxxx"
```

### PostgreSQL

**Local or managed database.**

```json
{
  "postgres": {
    "type": "postgres",
    "required": true,
    "config": {
      "host": "localhost",
      "port": 5432,
      "database": "myapp",
      "auth": "env:DB_PASSWORD"
    }
  }
}
```

**Setup (Local):**
```bash
# Install PostgreSQL
brew install postgresql  # macOS
sudo apt install postgresql  # Linux

# Start service
brew services start postgresql

# Create database
createdb myapp

# Add to credentials.sh:
export DB_PASSWORD="postgres://user:password@localhost:5432/myapp"
```

**Setup (Managed - Render.com):**
```bash
# 1. Create database at: https://render.com/
# 2. Copy connection string (includes credentials)
# 3. Add to credentials.sh:
export DB_PASSWORD="postgres://user:pass@your-db.render.com:5432/myapp"
```

### Stripe

**Payment processing.**

```json
{
  "stripe": {
    "type": "http",
    "required": true,
    "endpoint": "https://stripe-mcp.example.com",
    "auth": "env:STRIPE_MCP_KEY"
  }
}
```

**Setup:**
```bash
# 1. Create account: https://stripe.com
# 2. Go to: https://dashboard.stripe.com/apikeys
# 3. Copy test key (starts with sk_test_)
# 4. Add to credentials.sh:
export STRIPE_MCP_KEY="sk_test_xxx"
```

### Slack

**Team notifications and logs.**

```json
{
  "slack": {
    "type": "http",
    "required": false,
    "endpoint": "https://slack-mcp.example.com",
    "auth": "env:SLACK_BOT_TOKEN"
  }
}
```

**Setup:**
```bash
# 1. Create Slack app: https://api.slack.com/apps
# 2. Click "Create New App" → "From scratch"
# 3. Enter app name and workspace
# 4. Go to "OAuth & Permissions" → "Bot Token Scopes"
# 5. Add: chat:write, channels:read
# 6. Install to workspace
# 7. Copy Bot User OAuth Token (starts with xoxb-)
# 8. Add to credentials.sh:
export SLACK_BOT_TOKEN="xoxb-xxxx"
```

## Validation

### Check Config Validity

```bash
# Validate project.config.json schema
npm run validate-setup

# Check MCP servers
./scripts/validate-mcp.sh

# Check credentials
source scripts/credentials.sh
echo "GITHUB_TOKEN: ${GITHUB_TOKEN:0:10}..."
echo "DB_PASSWORD: ${DB_PASSWORD:0:20}..."
```

## Common Misconfigurations

| Issue | Cause | Fix |
|-------|-------|-----|
| `Unknown stack` | Invalid `stack` value | Use: `ts-react-node`, `py-fastapi`, `go-gin`, or `custom` |
| `Missing required server` | MCP not in config | Add to `mcp_servers` with `required: true` |
| `Auth failed` | Wrong credential | Regenerate API key, update credentials.sh |
| `Database won't connect` | Wrong host/port | Check `config.host` and `config.port` match your DB |
| `Feature not working` | Feature not in list | Add to `features` array |

---

**Next:** See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for running workflows locally.

