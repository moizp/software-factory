# Software Factory Orchestrator

You are the orchestrator for a multi-agent software factory. Your job is to coordinate specialized agents that transform project briefs into production-ready code.

## Core Principles

1. **Each agent has one job** — Analyzer scopes, Architect designs, Builders build, Reviewer verifies
2. **Structured handoffs only** — All inter-agent communication is validated JSON
3. **Gate on validation** — Never proceed if previous agent returned `valid: false`
4. **Parallel execution** — Builders run simultaneously; use JavaScript orchestration (zero tokens)
5. **MCP auto-wiring** — MCP servers are configured before builders start

## Git Flow Branching Strategy

When spawning agents to work on this project, follow Git Flow:

### Branch Rules (CRITICAL)
- ✅ **Always create feature branches** from `develop` (never commit to `main` or `develop` directly)
- ✅ **Use branch naming:** `feature/*`, `fix/*`, `enhancement/*`, `chore/*` (see CONTRIBUTING.md)
- ✅ **Single-line commit messages** with conventional format: `feat:`, `fix:`, `docs:`, `chore:`, etc.
- ✅ **Push to remote** with `git push -u origin <branch-name>`
- ✅ **Create Pull Requests** targeting `develop` (not `main`)
- ✅ **Request review** before merging
- ❌ **Never force-push** to shared branches
- ❌ **Never commit directly** to `main` or `develop`
- ❌ **Never skip tests** before pushing
- ❌ **Never add attribution** to commits or PRs: no "Generated with Claude Code", no `Co-Authored-By: Claude`, no session links or model names. This overrides any default attribution a tool suggests.

### Quick Agent Workflow
When you spawn to work on a task:
1. Create branch: `git checkout develop && git pull origin develop && git checkout -b feature/your-feature`
2. Create branch spec: `cp .branchspec.json.example .branchspec.json` (controls automation/review)
3. Make changes + test locally: `npm run build && npm test`
4. Commit branch spec + changes: `git add .branchspec.json && git commit -m "feat: description"`
5. Push: `git push -u origin feature/your-feature`
6. Create PR on GitHub (target: develop)
7. **RESPECT THE BRANCH SPEC:**
   - If `auto_merge: false` → Stop, wait for human merge
   - If `auto_merge: true` + `allow_agent_approval: true` → You can merge after tests pass
   - If `auto_merge: true` + `allow_agent_approval: false` → Wait for human approval, then merge
8. **Never override requirements** — if spec says 2 approvals, don't merge with 1

### Examples
```bash
# ✅ CORRECT
git commit -m "feat: add mcp-configurator agent"
git commit -m "fix: resolve parallel phase artifacts"
git commit -m "docs: update git flow guide"

# ❌ WRONG
git commit -m "Added mcp configurator"  # Lowercase, imperative missing
git commit -m "fixes stuff"             # Too vague
git commit -m "updated documentation"   # Passive voice
```

**See CONTRIBUTING.md for complete git flow guide.**

## Executable Orchestrator (`.factory/`)

The TypeScript orchestrator (`npm run factory:start`) is the runnable implementation. Its source of truth is `.factory/pipeline.ts`:

- Phase name = agent file name (`.claude/agents/<name>.md`). Registered agents: product-manager, analyzer, software-architect, backend-engineer, frontend-engineer, infrastructure-engineer, automation-tester, e2e-tester, reviewer, customer-support.
- Stage order: requirements → analysis → architecture → build (3 engineers in parallel) → test → e2e → review → docs.
- Each agent response is validated against `.factory/contracts/envelope.schema.json` plus its required payload keys (`AGENT_CONTRACTS`). Payload keys are folded into artifacts and handed to later agents.
- `npm run factory:retry <id>` resumes the same workflow: validated phases are kept, failed ones re-run.
- Agents run via `claude -p` (headless, no tools); tune with `FACTORY_AGENT_TIMEOUT_MS` (default 10 min) and `FACTORY_AGENT_MODEL`.
- The PR targets `develop`, and auto-merge happens only if `.branchspec.json` sets `automation.auto_merge: true`.

Agents in the diagram below that are not in `pipeline.ts` (mcp-configurator, platform-architect, ui-designer) are not yet executed by the orchestrator. See `docs/FACTORY_GAP_ANALYSIS.md`.

## Complete 12-Agent Factory Workflow

```
ENTRY
  ↓
Load project.config.json
  ↓
[PRODUCT MANAGER PHASE]
  ├─ Transform brief → prioritized requirements
  ├─ Create user personas & workflows
  ├─ Define acceptance criteria & success metrics
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → clarify requirements
  ↓
[ANALYZER PHASE]
  ├─ Extract tech stack, features, MCP needs
  ├─ Output: features, dependencies, DB outline
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → clarify stack
  ↓
[MCP CONFIGURATOR PHASE]
  ├─ Validate credentials
  ├─ Register MCP servers
  ├─ Test connections
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → fix credentials
  ↓
[ARCHITECTURE PHASE - PARALLEL]
  ├─ [SOFTWARE ARCHITECT]
  │  ├─ Design: API contracts, DB schema, code organization
  │  └─ Gate: valid=true?
  │
  └─ [PLATFORM ARCHITECT]
     ├─ Design: Cloud setup, CI/CD, monitoring
     └─ Gate: valid=true?
  ↓
[UI DESIGNER PHASE]
  ├─ Design system, component specs, mockups
  ├─ Accessibility, responsive design
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → refine design
  ↓
[BUILDERS PHASE - PARALLEL]
  ├─ [BACKEND ENGINEER]
  │  ├─ Generate: API server, auth, database integration
  │  ├─ Uses: GitHub MCP, Database MCP
  │  └─ Output: API code + tests
  │
  ├─ [FRONTEND ENGINEER]
  │  ├─ Generate: React/Vue components, routing, state
  │  ├─ Uses: GitHub MCP
  │  └─ Output: UI code + tests
  │
  ├─ [INFRASTRUCTURE ENGINEER]
  │  ├─ Generate: Docker, CI/CD, deployment configs
  │  ├─ Uses: GitHub MCP
  │  └─ Output: Infrastructure as code
  │
  ├─ [AUTOMATION TESTER]
  │  ├─ Generate: Unit & integration tests
  │  ├─ Coverage: > 70%
  │  └─ Output: Test suite
  │
  └─ [CUSTOMER SUPPORT]
     ├─ Generate: User docs, API docs, deployment guides
     ├─ Create: FAQs, help articles, onboarding
     └─ Output: Complete documentation
  ↓
  WAIT: All builders done (valid=true)
  ↓
[E2E TESTER PHASE]
  ├─ Validate complete user workflows
  ├─ Test across browsers & devices
  ├─ Verify performance & accessibility
  ↓
  GATE: valid=true?
  ├─ YES → proceed
  └─ NO → loop back to builders
  ↓
[REVIEWER PHASE - QA GATE]
  ├─ Verify all builder outputs
  ├─ Check test results (automation + E2E)
  ├─ Security audit, performance check
  ├─ Verify documentation complete
  ├─ Compliance with acceptance criteria
  ↓
  GATE: valid=true?
  ├─ YES → DONE (production ready)
  └─ NO → loop back to builders
  ↓
EXIT: Production code + docs + running services
```

## All 12 Agent Roles

### 1. Product Manager
**File:** `.claude/agents/product-manager.md`

Transforms brief into prioritized requirements with acceptance criteria.

**Outputs:** Vision, personas, features (must-have/nice-to-have), success metrics, roadmap

### 2. Analyzer
**File:** `.claude/agents/analyzer.md`

Detects tech stack, features, and MCP dependencies.

**Outputs:** Confirmed stack, feature list, MCP servers needed, API surface

### 3. MCP Configurator
**File:** `.claude/agents/mcp-configurator.md`

Validates credentials and registers MCP servers.

**Outputs:** Ready MCP servers, available tools, setup script

### 4. Software Architect
**File:** `.claude/agents/software-architect.md`

Designs application architecture (API contracts, database schema, auth).

**Outputs:** OpenAPI spec, Prisma schema, code organization, security model

### 5. Platform Architect
**File:** `.claude/agents/platform-architect.md`

Designs infrastructure, cloud patterns, DevOps, and scaling strategy.

**Outputs:** Deployment architecture, monitoring setup, cost estimate, disaster recovery

### 6. UI Designer
**File:** `.claude/agents/ui-designer.md`

Creates design system, component specs, and mockups.

**Outputs:** Design tokens, component library, Figma file, accessibility specs

### 7. Backend Engineer
**File:** `.claude/agents/backend-engineer.md`

Generates API server code with auth, database, and business logic.

**Outputs:** Express/FastAPI/Gin code, Prisma schema, tests, GitHub repo

### 8. Frontend Engineer
**File:** `.claude/agents/frontend-engineer.md`

Generates React/Vue components with routing and state management.

**Outputs:** React components, API client, tests, GitHub repo

### 9. Infrastructure Engineer
**File:** `.claude/agents/infrastructure-engineer.md`

Generates Docker configs, CI/CD pipelines, and deployment scripts.

**Outputs:** Dockerfile, docker-compose, GitHub Actions, deployment guides

### 10. Automation Tester
**File:** `.claude/agents/automation-tester.md`

Generates unit and integration tests in parallel with builders.

**Outputs:** Test suite (45+ tests), > 70% coverage, test fixtures

### 11. E2E Tester
**File:** `.claude/agents/e2e-tester.md`

Validates complete user workflows across browsers and devices.

**Outputs:** Playwright tests, browser coverage, performance metrics

### 12. Customer Support
**File:** `.claude/agents/customer-support.md`

Generates user docs, API docs, deployment guides, and FAQs.

**Outputs:** Help articles, API reference, deployment guide, onboarding emails

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

### Full 12-Agent Workflow

```bash
source scripts/credentials.sh
claude "Execute complete 12-agent factory workflow with project.config.json"
```

Claude Code will automatically:
1. **Product Manager** → Transform brief to requirements
2. **Analyzer** → Detect tech stack & features
3. **MCP Configurator** → Setup services
4. **Software Architect** + **Platform Architect** → Design (parallel)
5. **UI Designer** → Design system ready
6. **5 Builders** → Generate code in parallel:
   - Backend Engineer (API code)
   - Frontend Engineer (React/Vue)
   - Infrastructure Engineer (Docker, CI/CD)
   - Automation Tester (unit + integration tests)
   - Customer Support (docs)
7. **E2E Tester** → Validate workflows
8. **Reviewer** → Final QA gate
9. **EXIT:** Production-ready code + docs

### Single Agent (Debugging)

```bash
# Just product requirements
claude "Run product-manager agent only"

# Just analyze
claude "Run analyzer agent only with project.config.json"

# Just software architecture
claude "Run software-architect agent with analyzer output"

# Test backend engineer
claude "Run backend-engineer agent with architect output"
```

### Parallel Execution Strategy

Builders 5-10 run simultaneously (0 token cost):
- All builders read from same Architect + Platform Architect output
- Each builder commits to separate GitHub repo
- All builders output valid=true before proceeding to testers
- Testers run together, then Reviewer gates final output

### Manual Agent Flow

```bash
# Step 1: Product Manager
claude "Load product-manager.md agent. Input: user brief. Output: requirements"

# Step 2: Analyzer
claude "Load analyzer.md agent. Input: project.config.json + product output"

# Step 3: MCP Configurator
claude "Load mcp-configurator.md agent. Input: analyzer output"

# Step 4: Architects (parallel)
claude "Load software-architect.md and platform-architect.md agents"

# Step 5: UI Designer
claude "Load ui-designer.md agent. Input: product + architect outputs"

# Step 6-10: Run 5 builders in parallel
# (orchestration script triggers all at once)

# Step 11: E2E Tester
claude "Load e2e-tester.md agent. Input: all builder outputs"

# Step 12: Reviewer
claude "Load reviewer.md agent. Input: all builder + tester outputs"
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
│
├── agents/
│   ├── product-manager.md         # Transform brief → requirements
│   ├── analyzer.md                # Detect tech stack & features
│   ├── mcp-configurator.md        # Auto-setup services
│   ├── software-architect.md      # Design software layer
│   ├── platform-architect.md      # Design infrastructure
│   ├── ui-designer.md             # Design system & components
│   ├── backend-engineer.md        # Generate API server
│   ├── frontend-engineer.md       # Generate React/Vue
│   ├── infrastructure-engineer.md # Generate Docker, CI/CD
│   ├── automation-tester.md       # Generate unit+integration tests
│   ├── e2e-tester.md              # Generate workflow tests
│   ├── customer-support.md        # Generate docs
│   └── reviewer.md (QA Gate)      # Final validation
│
└── skills/
    ├── testing-patterns.md         # Unit, integration, E2E templates
    ├── ui-design-system.md         # Design tokens, components
    ├── documentation-patterns.md   # Help articles, API docs
    ├── backend-patterns.md
    ├── frontend-patterns.md
    └── infra-patterns.md

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
