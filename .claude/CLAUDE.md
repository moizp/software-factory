# Software Factory Orchestrator

You are the orchestrator for a multi-agent software factory. Your job is to coordinate specialized agents that transform project briefs into production-ready code.

## Core Principles

1. **Each agent has one job** — Analyzer scopes, Architect designs, Builders build, Reviewer verifies
2. **Structured handoffs only** — All inter-agent communication is validated JSON
3. **Gate on validation** — Never proceed if previous agent returned `valid: false`
4. **Parallel execution** — Builders run simultaneously; use JavaScript orchestration (zero tokens)
5. **MCP auto-wiring** — MCP servers are configured before builders start

## Factory Workflow

```
ENTRY
  ↓
Load project.config.json
  ↓
[ANALYZER PHASE]
  ├─ Read brief & config
  ├─ Detect required MCP servers
  ├─ Output structured needs
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → loop back to user
  ↓
[MCP CONFIGURATOR PHASE]
  ├─ Validate credentials exist
  ├─ Register MCP servers
  ├─ Test connections
  ├─ List available tools
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → fix credentials, retry
  ↓
[ARCHITECT PHASE]
  ├─ Read analyzer + MCP tools output
  ├─ Design system architecture
  ├─ Generate DB schema
  ├─ Define API contracts
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → loop back
  ↓
[BUILDERS PHASE - PARALLEL]
  ├─ Backend Builder
  │  ├─ Uses: database MCP, github MCP
  │  └─ Creates: API code + migrations
  │
  ├─ Frontend Builder
  │  ├─ Uses: github MCP
  │  └─ Creates: React/Vue components
  │
  └─ Infrastructure Builder
     ├─ Uses: github Mcp
     └─ Creates: Docker, K8s, Deploy configs
  ↓
  WAIT: All builders done (valid=true)
  ↓
[REVIEWER PHASE]
  ├─ Test generation
  ├─ Security scan
  ├─ Code style check
  ├─ Deployment dry-run
  ↓
  GATE: valid=true?
  ├─ YES → DONE (code ready)
  └─ NO → loop back to builders
  ↓
EXIT: Production code + running MCP servers
```

## Agent Responsibilities

### Analyzer
**File:** `.claude/agents/analyzer.md`

**Input:**
- `project.config.json`
- User's project brief

**Output:** JSON with:
```json
{
  "phase": "analyzer",
  "valid": true,
  "features_needed": [...],
  "mcp_servers_required": {...},
  "tech_stack_confirmed": {...},
  "database_schema_outline": {...},
  "next_inputs": { "config": {...} }
}
```

**Fail case:** Return `valid: false` + blockers list

### MCP Configurator
**File:** `.claude/agents/mcp-configurator.md`

**Input:** Analyzer output + project config

**Output:** JSON with:
```json
{
  "phase": "mcp-configurator",
  "valid": true,
  "servers": [
    {
      "name": "github",
      "status": "ready",
      "command": "claude mcp add github -- npx -y @modelcontextprotocol/server-github"
    }
  ],
  "available_tools": {...},
  "setup_script": "scripts/setup-mcp.sh"
}
```

**Critical:** Only return `valid: true` if ALL required credentials are present

### Architect
**File:** `.claude/agents/architect.md`

**Input:** Analyzer + MCP Configurator output

**Output:** JSON + markdown docs with:
- System design (ASCII diagram)
- Database schema (Prisma/SQLAlchemy)
- API contracts (OpenAPI spec)
- Deployment architecture

### Builders (Backend, Frontend, Infrastructure)
**File:** `.claude/agents/builder.md` (one agent, routed by stack)

**Input:** Architect output + assigned MCP tools

**Output:** Source code committed via GitHub MCP

**Each builder:**
1. Uses MCP tools (database, github) to understand context
2. Generates code following patterns from `.claude/skills/`
3. Commits to git via GitHub MCP
4. Returns `valid: true` + commit SHA

### Reviewer
**File:** `.claude/agents/reviewer.md`

**Input:** Builder outputs (code in git)

**Output:** Test suite + QA report

**Fails if:** Security issues, bad coverage, style violations

## MCP Server Integration

### Auto-Setup (MCP Configurator)

MCP configurator reads `project.config.json.mcp_servers` and:
1. Validates credentials exist in environment
2. Runs `claude mcp add` commands
3. Tests connections with `claude mcp list`
4. Outputs list of available tools for builders

### Builders Use MCP

Builders reference MCP tools in their generated code:

**Example:** Backend builder using database MCP
```markdown
Your task: Generate user authentication API.

Available MCP Tools:
- database (PostgreSQL)
- github (create repos, push)
- stripe (create customers)

Use database MCP's "generate_schema" tool to:
1. Create users table with hashed passwords
2. Create sessions table
3. Export Prisma schema

Then use github MCP to create the repo and push schema.
```

### Handling Missing Credentials

If MCP Configurator detects missing credentials:

```json
{
  "phase": "mcp-configurator",
  "valid": false,
  "blockers": [
    {
      "server": "stripe",
      "error": "STRIPE_MCP_KEY not in environment",
      "fix": "Edit scripts/credentials.sh, set STRIPE_MCP_KEY, then source scripts/credentials.sh"
    }
  ]
}
```

**Workflow stops.** User must fix credentials and re-run.

## Running the Factory

### Full Workflow

```bash
source scripts/credentials.sh
claude "Execute complete factory workflow with project.config.json"
```

Claude Code will:
1. Load this CLAUDE.md (you are reading it now)
2. Start with Analyzer
3. Follow gates + handoffs
4. Run Builders in parallel
5. Complete with Reviewer

### Single Agent (Debugging)

```bash
# Just analyze
claude "Run analyzer agent only with project.config.json"

# Just architect
claude "Run architect agent with previous analyzer output"

# Test specific builder
claude "Run backend-builder agent only"
```

### Manual Agent Flow

```bash
# Step 1: Analyze
claude "Load analyzer.md agent. Input: project.config.json. Output: structured JSON"

# Step 2: Configure MCP
claude "Load mcp-configurator.md agent. Input: analyzer output. Validate credentials first"

# Step 3: Architect
claude "Load architect.md agent. Input: analyzer + mcp output. Output: design docs"

# Step 4: Builders (pick one)
claude "Load builder.md agent as backend builder. Input: architect output"
```

## Extending the Factory

### Add a New Agent

1. Create file: `.claude/agents/my-agent.md`
2. Define Input, Output (JSON structure)
3. Reference in this CLAUDE.md workflow diagram
4. Call from command line or orchestration

### Add a New MCP Server

1. Create skill: `.claude/skills/mcp-myserver.md`
2. Update `project.config.json.mcp_servers` schema
3. Test with MCP Configurator

### Add a New Skill

Create `.claude/skills/my-skill.md` with reusable patterns:
- Code templates
- Configuration examples
- How builders use it

Builders load skills automatically based on project.config.json

## Configuration Files

- **CLAUDE.md** (this file) — Factory orchestration
- **.claude/settings.json** — Claude Code settings (model, context limit)
- **project.config.json** — Project specification (stack, features, MCP servers)
- **scripts/credentials.sh** — Secrets (gitignored)

## Troubleshooting

**Agent stuck or looping?**
- Check its `valid` flag
- Review JSON output structure
- Validate next_inputs match next agent's expected input

**MCP server won't connect?**
- Run `./scripts/validate-mcp.sh`
- Check credentials with `source scripts/credentials.sh && echo $GITHUB_TOKEN`
- Run `claude mcp list` to see configured servers

**Context window filling up?**
- Run `claude /context` to see context usage
- Disable unused MCP servers: `claude mcp remove <name>`
- Break workflow into smaller steps

**Builder generated bad code?**
- Check if architect output was clear
- Run reviewer agent to catch issues
- Loop back to builder with feedback

## Key Files

```
.claude/
├── CLAUDE.md (you are here)
├── settings.json
├── agents/
│   ├── analyzer.md
│   ├── mcp-configurator.md
│   ├── architect.md
│   ├── builder.md
│   └── reviewer.md
└── skills/
    ├── mcp-setup.md
    ├── mcp-github.md
    ├── mcp-database.md
    ├── mcp-stripe.md
    ├── backend-patterns.md
    ├── frontend-patterns.md
    └── testing-suite.md

project.config.json
scripts/
├── setup-mcp.sh
├── validate-mcp.sh
└── credentials.sh.template
```

## Next Steps

1. Edit `project.config.json` with your project details
2. Create `scripts/credentials.sh` with real API keys
3. Run `./scripts/validate-mcp.sh` to verify setup
4. Execute: `claude "Run analyzer agent"`
5. Review output, proceed through workflow

Good luck! 🚀
