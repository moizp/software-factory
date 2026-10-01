# Software Factory Quick Start

Welcome! You now have a complete, reusable multi-agent software development factory.

## What You Have

```
software-factory/
├── README.md                    ← Start here for complete overview
├── QUICKSTART.md               ← You are here
├── project.config.json         ← Configure your project
│
├── .claude/
│   ├── CLAUDE.md              ← Factory orchestration
│   ├── settings.json          ← Claude Code config
│   │
│   ├── agents/                ← 5 specialized agents
│   │   ├── analyzer.md
│   │   ├── mcp-configurator.md
│   │   ├── architect.md
│   │   ├── builder.md
│   │   └── reviewer.md
│   │
│   └── skills/                ← Reusable patterns
│       ├── mcp-setup.md
│       ├── backend-patterns.md
│       └── testing-suite.md
│
├── scripts/
│   ├── setup-mcp.sh          ← Auto-setup external services
│   ├── validate-mcp.sh       ← Test connections
│   └── credentials.sh.template ← API keys template
│
└── docs/
    └── mcp-setup-guide.md    ← Detailed MCP reference
```

## 5-Minute Setup

### 1. Prepare Credentials (2 min)

```bash
# Copy template
cp scripts/credentials.sh.template scripts/credentials.sh

# Edit with your API keys
nano scripts/credentials.sh
```

You need:
- **GitHub Token** — https://github.com/settings/tokens
- **PostgreSQL** — Local or https://render.com
- **Stripe** (optional) — https://stripe.com

### 2. Configure Project (1 min)

Edit `project.config.json`:

```json
{
  "name": "MyAwesomeApp",
  "type": "saas",
  "stack": "ts-react-node",
  "features": ["auth", "payments", "real-time"]
}
```

### 3. Setup MCP Servers (2 min)

```bash
source scripts/credentials.sh
./scripts/setup-mcp.sh
./scripts/validate-mcp.sh
```

Output should show: ✅ All servers connected

## Run the Factory

### Option A: Full Workflow (Recommended)

```bash
source scripts/credentials.sh
claude "Execute complete factory workflow"
```

The factory will:
1. ✅ Analyze your project
2. ✅ Configure MCP servers
3. ✅ Design architecture
4. ✅ Build backend, frontend, infrastructure (parallel)
5. ✅ Review and validate
6. ✅ Output production-ready code

### Option B: Step-by-Step

```bash
source scripts/credentials.sh

# Step 1: Analyze
claude "Run analyzer agent only"

# Step 2: Configure MCP
claude "Run mcp-configurator agent"

# Step 3: Design
claude "Run architect agent"

# Step 4: Build (pick one)
claude "Run backend-builder agent"
claude "Run frontend-builder agent"
claude "Run infrastructure-builder agent"

# Step 5: Review
claude "Run reviewer agent"
```

## Key Files Explained

### project.config.json

Tells the factory what to build:
- Project name & type
- Tech stack
- Features
- External services (MCP servers)

### .claude/agents/

**5 specialized agents:**

| Agent | Job |
|-------|-----|
| Analyzer | Reads brief, extracts requirements |
| MCP Configurator | Wires up GitHub, Stripe, Database |
| Architect | Creates system design & API spec |
| Builder | Generates production code |
| Reviewer | QA, security, tests |

### .claude/skills/

**Reusable templates:**

- `mcp-setup.md` — Service integration patterns
- `backend-patterns.md` — Server code templates
- `testing-suite.md` — Test scaffolds

### scripts/

**Automation:**

- `setup-mcp.sh` — Auto-install MCP servers
- `validate-mcp.sh` — Test connections
- `credentials.sh` — Your secrets (gitignored)

## Understanding the Flow

```
You run: claude "Execute complete factory workflow"
   ↓
ANALYZER
  Reads: project.config.json
  Outputs: Features, requirements, MCP needs
   ↓ (gates on valid=true)
MCP CONFIGURATOR
  Reads: Credentials + MCP server list
  Outputs: Connected servers ready for builders
   ↓ (gates on valid=true)
ARCHITECT
  Reads: Requirements + available MCP tools
  Outputs: Database schema, API spec, design docs
   ↓ (gates on valid=true)
BUILDERS (runs in parallel)
  Backend Builder  ← Uses database MCP, GitHub MCP
  Frontend Builder ← Uses GitHub MCP
  Infra Builder    ← Uses GitHub MCP
   ↓
REVIEWER
  Tests all code, security scans, validates
   ↓ (gates on valid=true)
DONE ✅
  Production-ready code in GitHub
  Deployed and running
  Tests passing, security clear
```

**Key insight:** Each agent validates the previous one's work. If something fails, the workflow stops and explains how to fix it.

## Example: Build a SaaS App

### Step 1: Set up

```bash
# Customize for your app
cat > project.config.json << EOF
{
  "name": "TaskManager",
  "type": "saas",
  "stack": "ts-react-node",
  "features": ["user-auth", "multi-tenant", "real-time-sync", "payments"]
}
EOF
```

### Step 2: Add credentials

```bash
# Edit scripts/credentials.sh with:
export GITHUB_TOKEN="ghp_..."
export DB_PASSWORD="postgres://..."
export STRIPE_MCP_KEY="sk_test_..."
```

### Step 3: Run factory

```bash
source scripts/credentials.sh
./scripts/setup-mcp.sh
claude "Execute complete factory workflow"
```

### Result

```
✅ Backend API (Express + PostgreSQL)
   - User authentication
   - Workspace management
   - Real-time WebSocket support
   - Stripe payment webhooks

✅ Frontend (React + TypeScript)
   - Login/register pages
   - Workspace UI
   - Real-time task updates
   - Payment form

✅ Infrastructure
   - Docker containers
   - GitHub Actions CI/CD
   - Deployment scripts
   - Environment configs

✅ Complete test suite
   - 45+ tests passing
   - 78% code coverage
   - Security scan: clear
```

All pushed to GitHub, ready to deploy!

## Troubleshooting

### "Claude Code not found"

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

### "MCP servers not connecting"

```bash
# Reload credentials
source scripts/credentials.sh

# Run validator
./scripts/validate-mcp.sh

# Read detailed guide
cat docs/mcp-setup-guide.md
```

### "Agent stuck or failed"

Each agent outputs JSON. Look for:
- `valid: true` — Success, proceed
- `valid: false` — Failed, read `blockers` array for fix

If confused, run the agent individually:

```bash
claude "Run analyzer agent only"
# Read output, fix issues, re-run
```

### "Credentials not loaded"

Must run in same shell session:

```bash
source scripts/credentials.sh
echo $GITHUB_TOKEN  # Should show your token

# Then run factory
claude "Execute complete factory workflow"
```

## Next Steps

1. **Read full docs** — `cat README.md`
2. **Understand MCP** — `cat docs/mcp-setup-guide.md`
3. **Customize for your stack** — Edit `project.config.json`
4. **Run analyzer first** — `claude "Run analyzer agent"`
5. **Proceed through workflow** — Follow gates and output

## Key Concepts

### MCP Servers
External tools (GitHub, Stripe, Database) that agents use:
- GitHub MCP → Push code, create repos
- Database MCP → Create schemas, run migrations
- Stripe MCP → Configure products, webhooks

### Agents
Specialized workers with one job each:
- They run in sequence (Analyzer → Architect → Builders)
- Each gates the next with validated JSON
- Builders run in parallel

### Skills
Reusable code patterns:
- Backend boilerplate
- Test templates
- MCP integration patterns

### Workflow
A DAG (directed acyclic graph):
- Nodes are agents
- Edges are validated handoffs
- Parallel execution where possible

## Support

- **Full README** — `README.md`
- **MCP Setup** — `docs/mcp-setup-guide.md`
- **Orchestration** — `.claude/CLAUDE.md`
- **Agent Details** — `.claude/agents/*.md`
- **Skill Patterns** — `.claude/skills/*.md`

## Stats

**This factory includes:**
- 🧠 5 specialized agents (analyzer, MCP configurator, architect, builders, reviewer)
- 🔧 3 core skills (MCP setup, backend patterns, testing)
- 📝 17 markdown files with detailed specifications
- ⚡ 2 bash scripts for automation
- 🔐 Credentials management with gitignore
- 📊 Example project configuration
- 📚 Full documentation

**Ready to build:**
- SaaS applications
- Web apps
- APIs
- Multi-tenant systems
- Payment-enabled platforms
- Real-time applications

## Go Build! 🚀

```bash
# Final check
source scripts/credentials.sh
./scripts/validate-mcp.sh

# Start factory
claude "Execute complete factory workflow"
```

That's it! Your software factory is running. Check back here if you get stuck.

---

**Questions?** Read `README.md` for complete reference.
