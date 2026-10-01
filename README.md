# Software Factory Template

A reusable, graph-engineered multi-agent workflow for building software projects with Claude Code. Supports SaaS, web apps, APIs, and custom stacks with automatic MCP server configuration.

## Quick Start

```bash
# 1. Clone/use this template
git clone <this-repo> my-project
cd my-project

# 2. Configure your project
cp project.config.json.example project.config.json
# Edit project.config.json with your specifics

# 3. Set up credentials
cp scripts/credentials.sh.template scripts/credentials.sh
# Edit scripts/credentials.sh with real API keys
source scripts/credentials.sh

# 4. Run the factory
claude "Execute factory workflow"
```

## Complete 12-Agent Factory

The factory is a **specialized multi-agent workflow** that transforms a project brief into production-ready code through distinct specialist roles:

```
Project Brief
    ↓
[1. PRODUCT MANAGER] ────→ Transform brief into requirements, personas, roadmap
    ↓
[2. ANALYZER] ────→ Detect tech stack, features, database needs
    ↓
[3. MCP CONFIGURATOR] ────→ Auto-wire GitHub, Stripe, Database, etc.
    ↓
    ┌─────────────────────────────────────┐
    ↓ (Parallel)                           ↓ (Parallel)
[4a. SOFTWARE ARCHITECT]        [4b. PLATFORM ARCHITECT]
    API design, DB schema              Infrastructure, scaling, DevOps
    Authentication, error handling     Containerization, monitoring
    ↓                                   ↓
    └──────────────────┬────────────────┘
                       ↓
        [5. UI DESIGNER]
        Design system, components, accessibility
                       ↓
    ┌──────────┬────────┬────────┬────────┬────────┐
    ↓          ↓        ↓        ↓        ↓        ↓ (Parallel)
[6a. BACKEND]  [6b. FRONTEND]  [6c. INFRA]  [6d. TESTS]  [6e. SUPPORT]
API server     React/Vue       Docker+CI/CD  Unit+Integ.  Docs+FAQs
JWT auth       Components      GitHub Actn.  Test suite   API Ref
Services       State mgmt      Monitoring    >70% coverage Guides
                ↓ All         ↓              ↓             ↓
                  └───────────────────────────────────────┘
                           ↓
                  [7. E2E TESTER]
                  Playwright workflows, browser coverage
                  User journey validation, performance
                           ↓
                  [8. REVIEWER] ◄─── QA Gate
                  Code quality, security audit
                  Test verification, compliance check
                           ↓
              Production Code + Deployed
```

### Parallel Execution Strategy

The factory optimizes for speed and parallelism:

- **Stage 4 (Architecture)**: Software Architect & Platform Architect run simultaneously
- **Stage 6 (Builders)**: Five specialized agents run in parallel:
  - Backend Engineer (API + database integration)
  - Frontend Engineer (UI components + state)
  - Infrastructure Engineer (Docker, CI/CD pipelines)
  - Automation Tester (unit + integration tests)
  - Customer Support (documentation + guides)
- **Estimated Time**: 5-10 minutes for complete workflow (zero token cost for orchestration)

## Project Structure

```
software-factory/
├── README.md                    # This file
├── project.config.json          # Your project specification
│
├── .claude/
│   ├── CLAUDE.md               # Factory main instructions
│   ├── settings.json           # Claude Code config
│   │
│   ├── agents/
│   │   ├── product-manager.md       # Requirements & personas
│   │   ├── analyzer.md              # Tech stack detection
│   │   ├── mcp-configurator.md      # Server auto-setup
│   │   ├── software-architect.md    # API design, DB schema
│   │   ├── platform-architect.md    # Infrastructure & DevOps
│   │   ├── ui-designer.md           # Design system & components
│   │   ├── backend-engineer.md      # API server generation
│   │   ├── frontend-engineer.md     # React/Vue generation
│   │   ├── infrastructure-engineer.md # Docker & CI/CD
│   │   ├── automation-tester.md     # Unit & integration tests
│   │   ├── e2e-tester.md            # Playwright workflows
│   │   ├── customer-support.md      # Docs, FAQs, guides
│   │   └── reviewer.md              # QA gate & verification
│   │
│   └── skills/
│       ├── testing-patterns.md         # Unit/integration/E2E templates
│       ├── ui-design-system.md         # Colors, typography, components
│       ├── documentation-patterns.md   # Help articles, API docs, guides
│       ├── backend-patterns.md         # Node/Python/Go starters
│       ├── frontend-patterns.md        # React/Vue starters
│       └── infra-patterns.md           # Docker/K8s/Deploy templates
│
├── scripts/
│   ├── setup-mcp.sh            # Auto MCP installation
│   ├── validate-mcp.sh         # MCP health check
│   └── credentials.sh.template # Secret template (gitignore this)
│
└── docs/
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

## All 12 Agent Roles

### Phase 1: Requirements & Planning

**1. Product Manager**
- Transforms brief into requirements with acceptance criteria
- Creates user personas and success metrics
- Defines feature priority (must-have vs. nice-to-have)
- Outputs: Vision, personas, roadmap with timelines

**2. Analyzer**
- Detects required tech stack and features
- Identifies database schema needs
- Lists required MCP servers
- Outputs: Confirmed stack, feature breakdown, infrastructure needs

**3. MCP Configurator**
- Validates all credentials exist in environment
- Auto-registers MCP servers with Claude Code
- Tests connections to each service
- Outputs: Ready MCP servers, available tools catalog

### Phase 2: Architecture & Design

**4a. Software Architect** (Parallel)
- Designs API contracts (OpenAPI spec)
- Creates database schema (Prisma/SQLAlchemy)
- Plans authentication flow (JWT, sessions)
- Defines code organization structure
- Outputs: API spec, DB schema, auth model, error handling

**4b. Platform Architect** (Parallel)
- Designs cloud infrastructure (serverless, containerized, or K8s)
- Plans deployment architecture (dev, staging, prod)
- Sets up monitoring and disaster recovery
- Calculates infrastructure costs
- Outputs: Deployment architecture, scaling strategy, cost estimates

**5. UI Designer**
- Creates design system (colors, typography, spacing)
- Specifies all components (Button, Input, Card, Modal, etc.)
- Defines accessibility requirements (WCAG AA)
- Plans responsive breakpoints and dark mode
- Outputs: Design tokens, component specs, design system documentation

### Phase 3: Implementation (All Parallel)

**6a. Backend Engineer**
- Generates API server code (Express/FastAPI/Gin)
- Implements authentication endpoints
- Creates CRUD operations for all entities
- Integrates with database via ORM
- Outputs: 19+ server files, Prisma schema, test suite

**6b. Frontend Engineer**
- Generates React/Vue components
- Implements routing and navigation
- Sets up state management (TanStack Query, Zustand)
- Creates API client with type safety
- Outputs: 20+ component files, hooks, tests

**6c. Infrastructure Engineer**
- Generates Dockerfile and docker-compose
- Creates GitHub Actions CI/CD pipelines
- Sets up deployment configurations
- Configures monitoring and health checks
- Outputs: Docker files, CI/CD workflows, deployment guides

**6d. Automation Tester**
- Generates unit tests (>70% coverage)
- Creates integration tests with database setup
- Builds test fixtures and mocks
- Tests API endpoints and services
- Outputs: 45+ tests, coverage reports, test utilities

**6e. Customer Support**
- Writes user documentation
- Creates API reference documentation
- Generates deployment guides
- Builds FAQ and onboarding emails
- Outputs: Help articles, API docs, deployment guides, onboarding series

### Phase 4: Validation & QA

**7. E2E Tester**
- Creates Playwright tests for user workflows
- Tests across browsers (Chrome, Firefox, Safari, Edge)
- Validates responsive design and accessibility
- Measures performance metrics
- Outputs: E2E test suite, workflow validation, performance metrics

**8. Reviewer** (QA Gate)
- Verifies all builder outputs
- Runs security audit
- Checks test coverage and passing tests
- Validates documentation completeness
- Approves deployment readiness
- Outputs: Approval status, compliance checklist, deployment sign-off

---

**All agents gate on structured JSON output** — next agent validates `valid: true` before proceeding.

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

### Add a New Specialist Agent

```bash
# 1. Create agent file
cat > .claude/agents/my-specialist.md << 'EOF'
# My Specialist Agent

You are responsible for [specific role in factory].

## Input
- [What previous agents output you need]
- [MCP tools required]
- [Configuration from project.config.json]

## Output
Return ONLY valid JSON:
{
  "phase": "my-specialist",
  "valid": true,
  "data": { ... },
  "blockers": []
}
EOF

# 2. Add to CLAUDE.md workflow
# Edit .claude/CLAUDE.md to insert your agent in the correct stage
```

### Add a New Parallel Builder

If you need additional builders (e.g., mobile, data pipeline):

```bash
# 1. Create agent in .claude/agents/mobile-engineer.md
# 2. Add to Stage 6 (Builders) in CLAUDE.md
# 3. Run in parallel with other Stage 6 agents (zero token cost)
# 4. Reviewer will automatically include in final verification
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

### Full 12-Agent Workflow

```bash
source scripts/credentials.sh
claude "Execute complete 12-agent factory workflow with project.config.json"
```

The factory will automatically:
1. **Product Manager** → Transform brief to requirements (8 min)
2. **Analyzer** → Detect tech stack & features (3 min)
3. **MCP Configurator** → Setup services (2 min)
4. **Architects** → Design software & platform (in parallel, 5 min)
5. **UI Designer** → Create design system (3 min)
6. **5 Builders** → Generate code in parallel (15 min):
   - Backend Engineer (API + database)
   - Frontend Engineer (React/Vue components)
   - Infrastructure Engineer (Docker + CI/CD)
   - Automation Tester (unit + integration tests)
   - Customer Support (documentation)
7. **E2E Tester** → Validate workflows (8 min)
8. **Reviewer** → Final QA gate (5 min)
9. **EXIT:** Production-ready code + deployed services

**Total: ~5-10 minutes with full parallelization**

### Step-by-Step Debugging

```bash
# Just requirements
claude "Run product-manager agent only"

# Just analyze
claude "Run analyzer agent only with project.config.json"

# Just architecture
claude "Run software-architect and platform-architect agents"

# Just one builder
claude "Run backend-engineer agent with architect output"

# Just testing & review
claude "Run e2e-tester and reviewer agents"
```

### Manual Control

```bash
# Run specific phase
claude "Execute product-manager through analyzer phases"

# Run architect phase only
claude "Run both architects in parallel, wait for completion"

# Run all builders
claude "Execute all 5 builders in parallel (zero token cost)"

# Check progress
claude "Status: list all generated files and test results"
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

1. **Test phase-by-phase** — Start with Product Manager → Analyzer → MCP Configurator before parallel phases
2. **Review handoffs** — Check JSON output at each gate to ensure `valid: true`
3. **Separate credentials** — Keep secrets in `scripts/credentials.sh` (gitignored)
4. **Pin MCP versions** — Lock server versions in `settings.json` for consistency
5. **Run single agents** — Debug individual agents before full workflow
6. **Document customizations** — If you modify agents, update CLAUDE.md and project.config.json
7. **Leverage parallelism** — Architects, builders, and testers run simultaneously (zero cost)
8. **Review final output** — Always check Reviewer gate before deploying to production

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

## Support & Docs

- **Claude Code** — https://docs.anthropic.com/claude-code
- **MCP Docs** — https://modelcontextprotocol.io
- **Graph Engineering** — See docs/graph-engineering-guide.md

## License

MIT — Use freely, modify, distribute.

---

**Questions?** Check `.claude/CLAUDE.md` for the complete workflow or run `claude /help` in your session.
