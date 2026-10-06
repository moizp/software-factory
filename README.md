# Software Factory Orchestrator

A reusable, graph-engineered multi-agent workflow that transforms project briefs into production-ready code with zero manual intervention.

⚠️ **Current Status:** This factory works for **local development and demonstrations**. GitHub Actions autonomous deployment is **not yet supported** — see [Limitations](#limitations) below.

**🚀 Key Features:**
- Fully autonomous 12-agent workflow (local)
- Parallel builders & testers (zero token overhead)
- Validation gates at each phase
- State persistence & retry capability
- GitHub Actions integration framework
- Complete documentation generation

---

## Quick Start (3 Steps)

### 1. Clone & Setup

```bash
git clone <repository> my-project
cd my-project
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit credentials.sh with real API keys
source scripts/credentials.sh
```

### 2. Create GitHub Issue

Create an issue with your project brief, then label it with **`ready-to-build`**.

Orchestrator detects the label and starts automatically.

### 3. Track Progress

Monitor the companion PR that gets created automatically. When done, all generated code is ready to merge.

---

## Limitations

### Current Environment Constraints

This factory **works for local development** but cannot yet run autonomously in GitHub Actions due to:

1. **Claude CLI Not Available** — GitHub Actions runners don't have `claude` command installed
2. **No Authentication** — Claude API credentials not available in Actions environment
3. **MCP Servers Offline** — GitHub, Postgres, Stripe, Slack, Supabase MCPs not wired to Actions
4. **Missing Credentials** — Service secrets (STRIPE_MCP_KEY, DB_PASSWORD, etc.) not configured
5. **No Code Artifact Storage** — Generated code has nowhere to persist post-workflow
6. **No Review Gate** — PR auto-merges without human oversight
7. **No Retry Loop** — Failures don't notify team or allow re-triggering
8. **Sequential Instead of Parallel** — Actions runs builders serially (not truly parallel)
9. **No Artifact Handoff** — Builder outputs not persisted between phases
10. **30-Second Timeout Risk** — Complex agents may exceed default timeout

**See [TODO.md](./TODO.md#-critical-blockers-production-readiness) for full blocking issues.**

### What Works Today

✅ **Local Development**
- Run orchestrator locally with `npm run factory:start`
- All agents available, MCP servers wired
- Full 12-agent workflow end-to-end

✅ **Proof of Concept**
- Test agent patterns and orchestration
- Verify output quality
- Design system patterns

✅ **Foundation**
- Production-ready architecture
- Extensible agent framework
- State persistence & retry logic

---

## How It Works

```
[Issue Labeled "ready-to-build"]
              ↓
[PHASE 1] Product Manager (2 min)
          → Requirements + personas
              ↓
[PHASE 2] Analyzer (3 min)
          → Tech stack detection
              ↓
[PHASE 3] Architects (5 min, parallel)
          → Software architecture + infrastructure
              ↓
[PHASE 4] Builders (12 min, parallel, zero cost)
          ├─ Backend Engineer → API server
          ├─ Frontend Engineer → React components
          ├─ Infrastructure Engineer → Docker + CI/CD
          ├─ Automation Tester → Test suite
          └─ Customer Support → Documentation
              ↓
[PHASE 5] E2E Tester (8 min)
          → Full workflow validation
              ↓
[PHASE 6] Reviewer (5 min, QA Gate)
          → Security audit + approval
              ↓
[COMPLETED] Production-ready code + PR + deployment guides
```

**Total Time:** ~35 minutes end-to-end (highly parallelized)

---

## The 12 Agents

| Phase | Agent | Role | Duration |
|-------|-------|------|----------|
| 1 | Product Manager | Transform brief → requirements | 2 min |
| 2 | Analyzer | Detect tech stack & features | 3 min |
| 3a | Software Architect | Design API + database schema | 5 min |
| 3b | Platform Architect | Design infrastructure & DevOps | 5 min |
| 3c | UI Designer | Create design system | 3 min |
| 4a | Backend Engineer | Generate API server | 12 min |
| 4b | Frontend Engineer | Generate React components | 12 min |
| 4c | Infrastructure Engineer | Generate Docker + CI/CD | 8 min |
| 4d | Automation Tester | Generate test suite | 10 min |
| 4e | Customer Support | Generate documentation | 8 min |
| 5 | E2E Tester | Validate end-to-end workflows | 8 min |
| 6 | Reviewer | Security audit + QA gate | 5 min |

**Phases 3 & 4 run in parallel** (no token overhead).

---

## Documentation

- **[ORCHESTRATION.md](./docs/ORCHESTRATION.md)** — Complete workflow guide
  - State machine diagram
  - Phase dependencies & validation gates
  - Troubleshooting & recovery
  - Performance tuning
  - Security considerations

- **[IMPLEMENTATION.md](./docs/IMPLEMENTATION.md)** — How to run locally
  - Running single agents
  - Debugging workflows
  - Common issues & fixes
  - Environment setup checklist

- **[CONFIGURATION.md](./docs/CONFIGURATION.md)** — Schema reference
  - `project.config.json` schema
  - MCP server setup guide
  - Environment variables
  - Example configurations

---

## Project Structure

```
software-factory/
├── README.md (this file)
├── package.json
├── tsconfig.json
├── project.config.json          # Your project specification
│
├── .factory/                    # Orchestrator engine
│   ├── orchestrator.ts         # Multi-agent orchestrator
│   ├── state.ts                # Workflow state management
│   ├── cli.ts                  # CLI commands
│   ├── README.md               # Orchestrator details
│   └── workflows/              # State files (gitignored)
│
├── .github/workflows/
│   └── factory-start.yml        # GitHub Actions trigger
│
├── .claude/
│   ├── CLAUDE.md               # Factory workflow definition
│   ├── settings.json           # Claude Code config
│   │
│   ├── agents/
│   │   ├── product-manager.md
│   │   ├── analyzer.md
│   │   ├── software-architect.md
│   │   ├── platform-architect.md
│   │   ├── ui-designer.md
│   │   ├── backend-engineer.md
│   │   ├── frontend-engineer.md
│   │   ├── infrastructure-engineer.md
│   │   ├── automation-tester.md
│   │   ├── e2e-tester.md
│   │   ├── customer-support.md
│   │   └── reviewer.md
│   │
│   └── skills/
│       ├── testing-patterns.md
│       ├── ui-design-system.md
│       ├── documentation-patterns.md
│       ├── backend-patterns.md
│       ├── frontend-patterns.md
│       └── infra-patterns.md
│
├── scripts/
│   ├── credentials.sh.template
│   └── validate-mcp.sh
│
└── docs/
    ├── ORCHESTRATION.md        # Workflow guide
    ├── IMPLEMENTATION.md       # Setup & debugging
    ├── CONFIGURATION.md        # Schema reference
    └── mcp-setup-guide.md      # MCP details
```

---

## Configuration

### project.config.json

```json
{
  "name": "MySaaS",
  "description": "Multi-tenant SaaS application",
  "type": "saas",
  "stack": "ts-react-node",
  "features": ["user-auth", "multi-tenant", "payments", "api"],
  
  "mcp_servers": {
    "github": {
      "type": "built-in",
      "required": true,
      "config": { "token": "env:GITHUB_TOKEN" }
    },
    "postgres": {
      "type": "postgres",
      "required": true,
      "config": { "host": "localhost", "auth": "env:DB_PASSWORD" }
    },
    "stripe": {
      "type": "http",
      "required": true,
      "endpoint": "https://stripe-mcp.example.com",
      "auth": "env:STRIPE_MCP_KEY"
    }
  },

  "backend": {
    "language": "typescript",
    "runtime": "node",
    "framework": "express",
    "orm": "prisma",
    "auth": "jwt"
  },

  "frontend": {
    "framework": "react",
    "language": "typescript",
    "styling": "tailwind",
    "state_management": "tanstack-query"
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

**See [CONFIGURATION.md](./docs/CONFIGURATION.md) for full schema.**

### Credentials (scripts/credentials.sh)

```bash
#!/bin/bash
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
export DB_PASSWORD="postgres://user:password@localhost:5432/mydb"
export STRIPE_MCP_KEY="sk_test_xxxxxxxxxxxx"
export SLACK_BOT_TOKEN="xoxb-xxxxxxxxxxxx"
```

**⚠️ Never commit this file** — add to `.gitignore`

---

## Running the Factory

### Option A: Local (Recommended - Works Today)

```bash
# 1. Install Claude Code CLI
#    https://claude.ai/code

# 2. Configure credentials
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit with real API keys
source scripts/credentials.sh

# 3. Validate setup
npm run validate-setup
./scripts/validate-mcp.sh

# 4. Start workflow
npm run factory:start "Build real-time chat app" 42

# 5. Monitor progress
npm run factory:watch wf-id
```

### Option B: Via GitHub (Future - Not Yet Supported)

```bash
# 1. Configure GitHub Secrets
#    - CLAUDE_API_KEY
#    - STRIPE_MCP_KEY
#    - DB_PASSWORD
#    - SLACK_BOT_TOKEN
#    - SUPABASE_KEY

# 2. Create GitHub issue with project brief
# 3. Add "ready-to-build" label
# 4. Orchestrator runs automatically (when blockers resolved)
# 5. Monitor progress in companion PR

# ⚠️ See Limitations section — GitHub Actions support coming soon
```

### Option C: Single Agent (Debugging - Local Only)

```bash
# Run just the Product Manager
claude "Run product-manager agent only"

# Run just the Backend Engineer
claude "Run backend-engineer agent with architect output"

# See all available agents
ls .claude/agents
```

---

## Validating Setup

```bash
# Check Node.js & npm
node --version  # Should be v18+
npm --version   # Should be v9+

# Validate credentials
source scripts/credentials.sh
echo $GITHUB_TOKEN  # Should not be empty

# Validate MCP servers
./scripts/validate-mcp.sh
# All servers should show ✅

# Validate project config
npm run validate-setup
```

---

## Key Concepts

### Validation Gates

Each phase must return `{ valid: true }` before proceeding:

```
Phase output → Orchestrator checks valid flag
├─ YES → Save state, continue
└─ NO → Pause workflow, await fix & retry
```

### Parallel Execution

Phases 3 (Architects) & 4 (Builders) run simultaneously:
- Software Architect + Platform Architect (parallel)
- All 5 builders (parallel, zero token cost)

### State Persistence

Workflow state saved after every phase in `.factory/workflows/`:
```json
{
  "id": "wf-1704067200000-abc123",
  "status": "running|completed|failed",
  "phases": [...],
  "artifacts": [...],
  "timeline": [...]
}
```

Allows **retry from any point** without re-running earlier phases.

### MCP Server Auto-Wiring

Orchestrator automatically:
1. Validates credentials from `scripts/credentials.sh`
2. Registers MCP servers via Claude Code
3. Provides available tools to each agent

---

## Troubleshooting

### Workflow Fails at MCP Setup

**Error:** `STRIPE_MCP_KEY not in environment`

**Fix:**
```bash
# Update credentials.sh with real key
export STRIPE_MCP_KEY="sk_test_xxx"

# Source it
source scripts/credentials.sh

# Retry workflow
npm run factory:retry wf-id
```

### Builder Throws TypeScript Error

**Cause:** Architect output missing type definitions

**Fix:**
```bash
# Retry from architect phase
npm run factory:retry wf-id --from-phase=software-architect
```

### Workflow Stuck (No Progress)

```bash
# Check current status
npm run factory:status wf-id

# If a phase failed or stalled, resume the same workflow (validated phases are kept)
npm run factory:retry wf-id
```

**See [IMPLEMENTATION.md](./docs/IMPLEMENTATION.md#common-issues--fixes) for more troubleshooting.**

---

## Extending the Factory

### Add a New Agent

```bash
# 1. Create agent file
cat > .claude/agents/my-agent.md << 'EOF'
# My Agent
...
EOF

# 2. Reference in .claude/CLAUDE.md workflow
```

### Add a New MCP Server

```bash
# 1. Update project.config.json
# 2. Update scripts/credentials.sh
# 3. Test with: ./scripts/validate-mcp.sh
```

### Customize for Your Team

Edit `.claude/CLAUDE.md` to add:
- Brand guidelines
- Code style preferences
- Security policies
- Deployment targets

---

## Architecture Overview

See **[ORCHESTRATION.md](./docs/ORCHESTRATION.md)** for:
- Complete state machine diagram
- Phase-by-phase invocation flow
- Validation gate details
- Error handling & recovery
- Performance metrics

---

## Requirements

- **Node.js** 18+ (`node --version`)
- **npm** 9+ (`npm --version`)
- **Git** (for GitHub integration)
- **Docker** (for infrastructure phase)
- **PostgreSQL** (for database phase, can be managed)

---

## Performance

**Typical workflow:**
- Phases 1-2 (sequential): 5 minutes
- Phase 3 (architects, parallel): 5 minutes
- Phase 4 (builders, parallel, zero cost): 12 minutes
- Phases 5-6 (validation, sequential): 13 minutes
- **Total: ~35 minutes**

**Token usage:** ~150K-200K per complete workflow

---

## Best Practices

1. **Test step-by-step** — Start with Product Manager → Analyzer before full workflow
2. **Review handoffs** — Check JSON output at each gate
3. **Separate credentials** — Keep secrets in `.gitignore`d `credentials.sh`
4. **Version MCP servers** — Pin versions in `settings.json` for consistency
5. **Monitor parallel phases** — All builders can fail independently
6. **Document customizations** — Update `.claude/CLAUDE.md` if modifying agents
7. **Leverage parallelism** — Phases 3 & 4 cost zero extra tokens
8. **Review Reviewer gate** — Always check before deploying

---

## Development Workflow

This project is **trunk-based**: `main` is the only long-lived branch.

```
main (trunk, always releasable)
  ↑
  ├─ feature/*      new features
  ├─ fix/*          bug fixes
  ├─ enhancement/*  improvements
  └─ chore/*        refactoring, deps, docs, CI
```

### Quick Start for Contributors

```bash
# 1. Create a short-lived branch from main
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# 2. Make changes, test, commit
npm run build && npm test
git add .
git commit -m "feat: your feature description"
git push -u origin feature/your-feature-name

# 3. Open a Pull Request targeting main; the merge policy labels it policy:auto or policy:manual
```

The factory has no release cadence. Apps it builds use release candidate branches promoted through `www-test` → `www-demo` → `www-prod` (see `.claude/skills/release-process.md`).

**Guides:**
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Branching guide & conventions
- [ADOPTING.md](./docs/ADOPTING.md) — Prompt for bringing the factory's practices into an existing project
- [POLICY.md](./docs/POLICY.md) — Which PRs agents may auto-merge and which need a human (`.factory/policy.json`)

---

## Next Steps

1. **Read** [ORCHESTRATION.md](./docs/ORCHESTRATION.md) for complete workflow details
2. **Follow** [IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) to run locally
3. **Review** [CONFIGURATION.md](./docs/CONFIGURATION.md) for schema reference
4. **Contribute** — See [CONTRIBUTING.md](./CONTRIBUTING.md) for git flow guidelines
5. **Edit** `.claude/CLAUDE.md` for your custom workflow

---

## License

MIT — Use freely, modify, distribute.

---

**Questions?** Check [ORCHESTRATION.md](./docs/ORCHESTRATION.md) or run `npm run factory:list`.

