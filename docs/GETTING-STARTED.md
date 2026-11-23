# Getting started

One path from a fresh clone to a verified first run. Each step has a command and a result you can check. `npm run verify` proves each step and writes a report you can paste back into a session when something fails.

```
clone, npm install
  ↓
npm run verify -- --quick ──────── any FAIL? ──► fix the row's "Next", run again
  ↓ (all PASS or SKIP)
declare the project: mission → character → look and feel → wiki → language → CLAUDE.md
  ↓
npm run verify ─────────────────── project.* rows PASS? (a SKIP means not declared yet)
  ↓
npm run verify -- --live ───────── real product manager answers inside its contract?
  ↓
npm run factory:start -- "<brief>" --until software-architect
  ↓
approve the plan: factory answer <id> "approve"
  ↓
(optional) GitHub lanes: npm run verify -- --github --create-labels
  ↓
paste verify-report.md into the session
```

## 1. Install

Needs Node 24 (`.nvmrc`; no other version is supported), git, and the `claude` CLI logged in (run `claude` once). The `gh` CLI is only needed for the GitHub checks. Agent runs use your Claude plan or key.

```bash
git clone https://github.com/moizp/software-factory && cd software-factory
npm install
```

The pipeline reads the project's declarations (`MISSION.md` and the others below) from the directory you run it in, so a project today is a clone of this repository with its own declarations at the root. `project.config.json` must exist (the sample one works; `{"name": "my-app", "mcp_servers": {}}` is enough). Existing projects can adopt the working practices only: [ADOPTING.md](ADOPTING.md).

## 2. Verify the factory (no tokens, no network)

```bash
npm run verify -- --quick      # about 15 seconds; drop --quick to also run the factory's own tests (about 2 minutes)
```

It checks, in order:

| Tier | What it proves |
|---|---|
| `env.*` | Node 24, git, dependencies, `claude` and `gh` present |
| `offline.*` | It compiles; the 10 agent prompts and contracts agree and fit their token budgets; commit and test-selection gates behave; (without `--quick`) the full test suite passes |
| `project.*` | Your declarations parse (mission, character, look and feel, glossary, wiki, `CLAUDE.md`, board) and the merge policy fails closed: an empty diff, a protected path or a `needs-human` label always goes to a person |
| `mock.*` | The whole pipeline runs with a model-free agent: all 10 agents in order; each declaration reaches the agents meant for it; plan approval pauses the build; a broken reply is re-asked once; a declined phase leaves a handoff and `retry` resumes; an agent's question pauses and resumes with the answer; the token cap pauses and lifting it resumes; the event log replays to the saved state |

The result is printed and written to `verify-report.md` (ignored by git) between `BEGIN` and `END` markers. Credentials are removed from it before it is written. A row is `PASS`, `WARN` (works, but look), `FAIL` (exit code 1), or `SKIP` (not asked for, or not declared yet, with the step that fixes it).

## 3. Declare the project

Each step is an interview in Claude Code, a checker you can run, and a row in the report. Do them in this order, because each is checked against the one before.

| Step | Command in Claude Code | Check | Report row |
|---|---|---|---|
| Mission | `/mission` | `npm run mission:check` | `project.mission` |
| Character | `/character` | `npm run character:check` | `project.character` |
| Look and feel (skip without a UI) | `/lookfeel` | `npm run lookfeel:check` | `project.lookfeel` |
| Wiki | copy `templates/project/docs/wiki` to `docs/wiki`, then `/wiki` | `npm run wiki:check` | `project.wiki` |
| Language | `/language` | `npm run language:check` | `project.language` |
| `CLAUDE.md` | `/claude-md` | `npm run claudemd:check` | `project.claudemd` |

Before the first real piece of work run `/grill`. The pipeline runs without any of these (it adds a note), and `FACTORY_REQUIRE_MISSION=1`, `FACTORY_REQUIRE_CHARACTER=1`, `FACTORY_REQUIRE_LOOKFEEL=1` and `FACTORY_REQUIRE_LANGUAGE=1` make each one mandatory. Run `npm run verify -- --quick` again after each; `mock.project-declarations` runs the pipeline on a copy of your own files.

## 4. Spend a few tokens

```bash
npm run verify -- --live          # the real product manager once
npm run verify -- --live=plan     # through the architect
```

It runs in a temporary copy of your declarations, with plan approval off and a token cap (`--cap`, default 150000), and reports the model, effort, calls, re-asks and tokens per agent. A `WARN` with re-asks means a first reply broke its contract; a `FAIL` shows the agent's own error. Paste the report to have the prompt fixed.

## 5. Run a real job

```bash
npm run factory:start -- "<your brief>" --until software-architect
npm run factory:list
```

The run pauses with the architect's plan as a question (plan approval is on by default; `FACTORY_PLAN_APPROVAL=0` skips it). Read the plan, then:

```bash
npm run factory:answer -- <workflow-id> "approve"       # or say what to change
npm run factory:retry <workflow-id>                      # continue; finished phases are kept
```

A run that stops leaves `workflows/<id>.handoff.md`: why, what was done, and the next command. `npm run factory:replay -- <id>` checks the event log against the saved state.

What a run produces today: structured requirements, an analysis, an architecture and an implementation plan, file lists with descriptions from the three builders, test and e2e plans, a review verdict, and documentation. It does not write code into a branch or open a pull request yet (see `docs/NEXT-CAPABILITIES.md`, F6 and T1). The verification proves the pipeline, not the quality of generated code.

## 6. Before and after pictures (projects with a UI)

An agent that changes what people see photographs it before and after, and puts both in the pull request and on the issue ([the rules](../.claude/skills/visual-evidence.md)).

```bash
npm install -D playwright && npx playwright install chromium     # in the project
# project.config.json: "preview": { "command": "npm run dev", "url": "http://localhost:3000" }
npm run verify -- --quick       # project.preview and offline.evidence show it is ready
```

The architect lists `visual_checks` (screens and widths) in the plan you approve. The builder then runs `npm run evidence:capture -- --label before`, makes the change, runs it with `--label after`, and `npm run evidence:publish -- --issue <n> --commit <sha>` writes an `## Evidence` table for the PR and the issue. Pictures are stored on an `evidence` branch, never on main. The PR text check asks for them whenever the diff touches interface files.

## 7. GitHub lanes (optional)

For agents that pick up issues labelled `agent:ready` in GitHub Actions (design: [CLOUD-RUNNERS.md](CLOUD-RUNNERS.md)):

```bash
npm run verify -- --github                  # read-only: gh login, labels, workflows, secret and variable names, branch protection
npm run verify -- --github --create-labels  # also create the labels that are missing
npm run verify -- --github --issue 12       # what the lanes did for issue 12: labels, comments, recent runs
```

Set the secret `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) and the variable `AGENTS_ENABLED=true` in the repository settings by hand. The report lists names only, never values. Nothing here has run end to end in Actions yet: a `PASS` means the setup is in place, and the first labelled issue is the real test. Paste `--issue` output to have a stuck run diagnosed.

## 8. Read a failure

| Row | Usual cause | Fix |
|---|---|---|
| `env.node` | Not Node 24 | `nvm install` (reads `.nvmrc`), `npm install` |
| `offline.typecheck` / `offline.unit` | A change broke the factory | Fix the first error shown; the report has the tail of the output |
| `offline.prompts` | An agent prompt grew past its budget | Shorten it, or raise `.factory/prompt-budgets.json` in a reviewed change |
| `project.*` FAIL | A declaration has a placeholder or a missing field | The report lists each problem; edit the file, run the check named in section 3 |
| `project.policy` | A policy that would auto-merge a protected change, or names a requirement the merge step cannot check | `docs/POLICY.md` |
| `mock.*` | The orchestrator or a contract changed | Paste the report; the notes show where the run stopped |
| `offline.evidence` | Chromium cannot take a picture, or two captures of the same page differ | `npx playwright install chromium`; paste the report if the bytes differ |
| `live.agents` | The model broke a contract twice, or `claude` is not logged in | Paste the report |

Pasting `verify-report.md` into a session gives the whole picture in one message: versions, every row, the output of every failure and the next steps in order.

## Flags

`--quick` skip the factory's tests · `--live[=plan]` real agents · `--cap <tokens>` live token cap · `--brief "<text>"` live brief · `--github` · `--create-labels` · `--issue <n>` · `--project <dir>` verify another directory's declarations · `--only <id-prefix>` run some rows (`--only mock`) · `--out <file>` · `--list` show every check.
