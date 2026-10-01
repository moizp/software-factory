# Software Factory Template

A reusable, graph-engineered multi-agent workflow for building software projects with Claude Code. Supports SaaS, web apps, APIs, and custom stacks with automatic MCP server configuration.

## Quick Start

### Option 1: Autonomous Workflow (GitHub Integrated)

```bash
# 1. Clone/use this template
git clone <this-repo> my-project
cd my-project

# 2. Set up credentials
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit scripts/credentials.sh with real API keys
source scripts/credentials.sh

# 3. Create a GitHub issue with your project brief
# Label it with "ready-to-build"

# 4. Workflow starts automatically!
# Track progress in the companion PR
```

### Option 2: Manual Orchestration

```bash
# 1. Configure your project
cp project.config.json.example project.config.json
# Edit project.config.json with your specifics

# 2. Run orchestrator manually
npm install
npm run factory:start "Build a user authentication system" 123

# 3. Monitor progress
npm run factory:watch wf-1704067200000-abc123def

# 4. Check status
npm run factory:list
```

## Autonomous Workflow

The factory now includes a **fully autonomous orchestrator** that manages the entire workflow from issue to production code:

```
[Issue Created + "ready-to-build" Label]
    ↓
[GitHub Actions Trigger]
    ↓
[Factory Orchestrator] (fully autonomous)
    ├─ [Sequential] Product Manager
    ├─ [Sequential] Analyzer
    ├─ [Sequential] Architect
    ├─ [Parallel] Backend/Frontend/Infrastructure Builders
    ├─ [Parallel] Backend/Frontend/Infrastructure Testers
    ├─ [Sequential] E2E Tester
    ├─ [Sequential] Reviewer
    └─ [Sequential] Customer Support
    ↓
[Production Code + PR + Documentation]
```

**Key Features:**
- ✅ **Fully Autonomous** — No human intervention needed after labeling issue
- ✅ **State Persistence** — Track workflows, retry from failures
- ✅ **Parallel Execution** — Builders and testers run simultaneously
- ✅ **Validation Gates** — Each phase must pass before proceeding
- ✅ **Real-Time Monitoring** — CLI tools to watch progress
- ✅ **Full Documentation** — Auto-generated deployment guides

**See:** `docs/ORCHESTRATION.md` for complete workflow details

## Project Structure

```
software-factory/
├── README.md                    # This file
├── package.json                 # Node.js dependencies
├── tsconfig.json               # TypeScript configuration
├── project.config.json          # Your project specification
│
├── .factory/                    # Orchestration engine
│   ├── state.ts               # Workflow state management
│   ├── orchestrator.ts        # Multi-agent orchestrator
│   ├── cli.ts                 # Command-line interface
│   ├── test.ts                # Test suite
│   ├── README.md              # Orchestrator documentation
│   └── workflows/             # Workflow state files (gitignored)
│
├── .github/
│   └── workflows/
│       └── factory-start.yml   # GitHub Actions trigger
│
├── .claude/
│   ├── CLAUDE.md              # Factory main instructions
│   ├── settings.json          # Claude Code config
│   │
│   ├── agents/
│   │   ├── product-manager.md # Requirements refinement
│   │   ├── analyzer.md        # Feature/tech detection
│   │   ├── architect.md       # Design & contracts
│   │   ├── builder.md         # Code generation
│   │   └── reviewer.md        # QA & security gates
│   │
│   └── skills/
│       ├── mcp-setup.md       # MCP automation
│       ├── backend-patterns.md # Node/Python/Go starters
│       ├── frontend-patterns.md# React/Vue starters
│       └── testing-suite.md    # Test scaffolds
│
├── scripts/
│   ├── credentials.sh.template # Secret template (gitignore this)
│   └── validate-mcp.sh         # MCP health check
│
└── docs/
    ├── ORCHESTRATION.md        # Complete orchestration guide
    └── mcp-setup-guide.md      # Detailed MCP reference
```

## Configuration

### project.config.json

```json
{
  "name": "MyAwesomeSaaS",
  "type": "saas",
  "stack": "ts-react-node",
  "features": ["auth", "payments", "real-time"],
  
  "mcp_servers": {
    "github": {
      "type": "built-in",
      "required": true,
      "config": { "token": "env:GITHUB_TOKEN" }
    },
    "stripe": {
      "type": "http",
      "required": true,
      "endpoint": "https://stripe-mcp.example.com",
      "auth": "env:STRIPE_MCP_KEY"
    },
    "postgres": {
      "type": "postgres",
      "required": true,
      "config": { "host": "localhost", "auth": "env:DB_PASSWORD" }
    }
  }
}
```

**Required fields:**
- `name` — Project name
- `type` — `saas` | `web-app` | `api` | `monorepo`
- `stack` — `ts-react-node` | `python-fastapi` | `go-htmx` | custom
- `features` — List of features to build
- `mcp_servers` — External tools needed

### Credentials (scripts/credentials.sh)

```bash
#!/bin/bash
export GITHUB_TOKEN="ghp_xxxxxx"
export STRIPE_MCP_KEY="sk_test_xxxxxx"
export DB_PASSWORD="postgres://..."
export SLACK_BOT_TOKEN="xoxb-..."
```

**Never commit this file** — add to `.gitignore`

## How Agents Work

### 1. Analyzer
Reads `project.config.json` and brief. Outputs:
- Required tech stack
- Database schema outline
- MCP servers needed
- Feature priority

### 2. MCP Configurator
Takes analyzer output. Sets up:
- Validates credentials exist
- Registers MCP servers with Claude Code
- Tests connections
- Lists available tools for builders

### 3. Architect
Creates:
- System design (diagrams + text)
- Database schema (normalized for stack)
- API contracts (OpenAPI spec)
- Deployment architecture

### 4. Builders (Parallel)
Each specialized builder uses MCP tools:
- **Backend** — Uses database MCP, GitHub MCP to create API
- **Frontend** — Uses GitHub MCP, optionally CMS MCP
- **Infrastructure** — Uses GitHub MCP to push configs

### 5. Reviewer
Runs:
- Unit test generation
- Security scanning
- Code style validation
- Deployment dry-run

All agents gate on **structured JSON output** — next agent validates before proceeding.

## MCP Servers Reference

| Server | Type | Use Case |
|--------|------|----------|
| GitHub | Built-in | Version control, CI/CD |
| Stripe | HTTP | Payment processing, webhooks |
| PostgreSQL | Local | Database schema, queries |
| Slack | HTTP | Notifications, logs |
| Supabase | HTTP | Auth, realtime DB |
| Anthropic Docs | HTTP | Current Claude docs lookup |

See `docs/mcp-setup-guide.md` for detailed MCP setup.

## Extending the Factory

### Add a New Builder

```bash
# 1. Create agent
cat > .claude/agents/mobile-builder.md << 'EOF'
# Mobile Builder Agent

You specialize in React Native / Flutter apps.
Inputs: Architecture from architect + MCP servers (GitHub, Firebase)
Outputs: Mobile app source code + test suite
EOF

# 2. Add to CLAUDE.md workflow
# Edit .claude/CLAUDE.md to include mobile-builder in parallel builders
```

### Add a New MCP Server

```bash
# 1. Create skill
cat > .claude/skills/mcp-firebase.md << 'EOF'
# Firebase MCP Skill

Configure via project.config.json:
{
  "firebase": {
    "type": "http",
    "endpoint": "https://firebase-mcp.example.com",
    "auth": "env:FIREBASE_KEY"
  }
}

Provides tools: list_projects, deploy, read_config
EOF

# 2. Update project.config.json to include firebase server
```

### Customize for Your Team

Edit `.claude/CLAUDE.md` to add:
- Brand guidelines
- Code style preferences
- Security policies
- Deployment targets

## Running the Factory

### Autonomous Mode (Recommended)

```bash
# 1. Create a GitHub issue with your project brief
# 2. Add the "ready-to-build" label
# 3. Orchestrator runs automatically!
# 4. Monitor in the companion PR

# Optional: Check status via CLI
npm run factory:status wf-1704067200000-abc123def
npm run factory:list
npm run factory:watch wf-1704067200000-abc123def
```

### Manual Mode

```bash
# Start a workflow
npm run factory:start "Build user authentication" 123

# Monitor progress
npm run factory:watch wf-1704067200000-abc123def

# Retry from failure
npm run factory:retry wf-1704067200000-abc123def

# List all workflows
npm run factory:list
```

### Legacy: Step-by-Step via Claude Code

```bash
source scripts/credentials.sh
claude "Execute the complete factory workflow"
```

### Validate MCP Setup

```bash
./scripts/validate-mcp.sh
# Lists all configured MCP servers and tests connection
```

## Reusability

This factory is designed to be **project-agnostic**:

- ✅ Same agents work for SaaS, web apps, APIs
- ✅ Swappable stacks (Node, Python, Go)
- ✅ Configurable MCP servers per project
- ✅ Extensible skill patterns

**Across projects, only change:**
- `project.config.json` (project spec)
- `scripts/credentials.sh` (API keys)

Everything else reuses the factory.

## Troubleshooting

### MCP Server Won't Connect

```bash
# Check if server is running
claude mcp list

# Verify credentials
source scripts/credentials.sh
echo $GITHUB_TOKEN

# Validate config
./scripts/validate-mcp.sh
```

### Agent Handoff Failed

Check the previous agent's JSON output. It should be valid and include:
- `valid: true`
- `next_inputs: { ... }` (properly formatted)

### Out of Context

Run:
```bash
claude /context
```

If MCP servers consume too much context, disable unused ones:
```bash
claude mcp remove <server-name>
```

## Best Practices

1. **Start small** — Test with analyzer + architect before adding builders
2. **Review handoffs** — Check JSON output between agents before auto-proceeding
3. **Separate credentials** — Keep secrets in `scripts/credentials.sh` (gitignored)
4. **Pin versions** — Lock MCP server versions in `settings.json`
5. **Test locally first** — Run single agents before full workflow
6. **Document customizations** — If you modify agents, update CLAUDE.md

## Advanced: Custom Agents

Add any agent by creating `.claude/agents/your-agent.md`:

```markdown
# Your Custom Agent

You are responsible for X task.

## Input
- Previous agent output (structured JSON)
- Project config
- Available MCP tools

## Output
Return ONLY this JSON:
{
  "phase": "your-agent",
  "valid": true,
  "data": { ... },
  "next_inputs": { ... },
  "blockers": []
}
```

Then reference in `.claude/CLAUDE.md` workflow.

## Documentation

- **Orchestration Guide** — `docs/ORCHESTRATION.md` — Complete workflow documentation
- **Orchestrator README** — `.factory/README.md` — Architecture and components
- **Agent Responsibilities** — `.claude/CLAUDE.md` — Factory workflow and agents
- **MCP Setup** — `docs/mcp-setup-guide.md` — MCP server configuration

## External Resources

- **Claude Code** — https://docs.anthropic.com/claude-code
- **MCP Docs** — https://modelcontextprotocol.io

## License

MIT — Use freely, modify, distribute.

---

**Questions?** Check `.claude/CLAUDE.md` for the complete workflow or run `claude /help` in your session.
