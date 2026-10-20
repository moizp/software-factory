# The factory as an MCP server: feasibility and effectiveness

Assessed in October 2026 against `main` after the HumanLayer additions (H1 to H6), and checked again after `docs/HUMANLAYER-VERIFIED.md` merged (see "After the HumanLayer check"). The question: could projects that use the factory get its parts through an MCP server, more efficiently and reliably than they do now? The short answer is **yes for the deterministic parts, as a thin local wrapper, after packaging; no for running the pipeline**. Numbers come from a throwaway spike (below); what could not be tested here is listed at the end.

## Verdict

```
what a project uses                      as MCP?        why
────────────────────────────────────────────────────────────────────────────────────────────
checkers (mission, character, look and   YES, tools     pure, tested, fast; removes vendoring and version drift
feel, language, wiki, CLAUDE.md, plan,
policy, commit, PR text, test selection)
declared context (what agents receive)   YES, tool      same view as the pipeline; makes H4's per-agent packs inspectable
skills, templates, writer commands       OPTIONAL       already installed to ~/.claude by bootstrap.sh; helps other MCP clients
workflow status and pending questions    LATER, read    thin over files and GitHub; read-only
start, retry, answer, merge              NO             approving through the model that is being asked breaks principle 1
running the pipeline (claude -p agents)  NO             minutes to hours, tokens, subprocess and credentials; keep in Actions lanes and the CLI
remote multi-tenant service              NOT NOW        auth, tenancy, cost and data questions; nothing has run for real yet (M0)
```

## What the spike showed

An 81-line stdio server (official SDK 1.32.1, protocol 2025-11-25) wrapping the compiled factory modules, run against a sample project built from the skills' own examples. Four tools: `factory_check` (kind: mission, character, lookfeel, language, wiki, claude_md), `factory_plan_check`, `factory_policy_decide`, `factory_context`; plus 19 skills as resources and 17 writer commands as prompts.

| Measure | Result |
|---|---|
| Start (spawn plus initialize) | 177 ms |
| Each tool call, steady state | 1 to 6 ms (20 wiki checks in 20 ms) |
| Today's route to the same check: `npm run` with ts-node | 1.1 to 1.7 s per call |
| Compiled CLI, no server | 0.03 s per call |
| Server memory | 75 MB after start, 87 MB after 200 calls |
| Context cost of the four tool definitions | 2,068 characters, about 520 tokens |
| Listing 19 resources and 17 prompts | about 560 and 720 tokens (only if a client loads them) |

Behaviour checked: the checkers return structured results (`ok`, errors, warnings), the plan check returns the summary a person approves, and the policy tool returns the same decision the pipeline's end-of-run step uses (agents may merge a change that touches nothing protected; a person for `.github/workflows/`).

Facts read from the SDK itself: protocol version `2025-11-25`; **default request timeout is 60 seconds**, extended only if the server sends progress and the client opts in (`resetTimeoutOnProgress`); tool annotations (`readOnlyHint`, `destructiveHint`) exist; elicitation (the server asking the person through the client) exists; an experimental tasks mechanism for long-running work exists. The SDK pulls about 95 packages; the factory itself has three runtime dependencies.

## What an MCP server adds, and what it does not

**Adds**
- **No vendoring.** `docs/ADOPTING.md` has each project copy `.factory/` and keep it in step. One versioned server replaces the copy, so the parsers a project runs match the files it declares.
- **Speed.** About 1.4 s to a few milliseconds per check, which matters for a tight feedback loop (principle 4) when a session checks after every edit.
- **Structured results.** The model receives errors as data, not text scraped from a CLI.
- **Other clients.** Anything that speaks MCP gets the checkers, not only Claude Code.

**Does not add**
- **Distribution by itself.** An npm package with a `bin` gives the same de-vendoring, works in CI and scripts, and needs no client support. MCP is a delivery interface on top; build the package first.
- **Much for slash commands.** `bootstrap.sh` already installs the writer commands; MCP prompts would be namespaced copies.
- **Control of the pipeline.** The control plane is GitHub issues and labels, and GitHub's own MCP server already creates issues and sets labels. A factory tool for that would duplicate it.

## Blockers found

1. **Packaging.** `package.json` has no `bin`, no `files`, and the name is `software-factory`; `dist/` is 1.2 MB across 45 modules. It is not publishable as it stands.
2. **The repository is private.** `docs/ADOPTING.md` tells a session to attach the private repo. A project cannot `npx` it from public npm. It needs GitHub Packages (with a token), a git dependency, or a public package. This decides how "efficient" distribution is.
3. **Node 24 only.** A local stdio server still needs the project's machine to run Node 24. Only a remote server or a packaged binary removes that.
4. **Long calls.** A pipeline run is many `claude -p` calls of up to 10 minutes each. A synchronous tool would hit the 60 second default. Anything long must be start, then poll.
5. **Pipeline agents must not load it.** They run tool-less (`--tools ""`) from an empty directory, which is why a call costs about 2,500 tokens and not 9,400. Giving them an MCP server would add tool definitions to every call.

## Principles check

- **People direct (1).** A tool that answers a question or approves a plan lets the model approve its own plan, since plan approval is a typed question answered with `approve`. No `answer`, `approve` or `merge` tool. Any tool that changes state is human-confirmed (elicitation) and off in headless runs. No tool of ours sets `agent:ready` or a `ready:*` label either: a person does. The GitHub MCP server can set a label in a model-driven session, so the factory's guidance says not to.
- **Deep modules (2).** Four tools over 45 modules is the shape we want. Keep the surface small: coarse tools with an enum, not one tool per checker. About ten tools is the ceiling for context cost.
- **Shared understanding (3).** `factory_context` takes an `agent` and returns what that agent would see: only the inputs its contract names, in H4's precedence order. That makes the packs inspectable by a person.
- **Feedback loops (4).** The measured speed-up is the point.
- **Value over metrics (5).** Do not count tool calls or token savings as value. The measure is whether sessions catch declaration errors earlier.
- **Treat results as data.** Tool output that quotes issue or wiki text goes back into the model's context. Return it marked as quoted data, as the pipeline does.

## Recommendation, in order

```
S0 package the core     bin + files + exports, semver, one install route that works for a private repo    S
 ▼
S1 local stdio server   ≤ 6 read-only tools (`factory_context(agent)` among them), structured output,        S–M
 │                      annotations; run from dist, not ts-node
 │                      tests with the SDK's in-memory client; gates: start < 500 ms, definitions < 1k tokens
 ▼
S2 read-only status     workflows, pending questions, handoffs, events; links to the issue or PR           S–M
 ▼
S3 decision (remote)    only after M0 has run for real, a second project needs it, and auth, tenancy,      L
                        cost metering and data handling are designed. Use elicitation for confirmations
```

S0 and S1 fit before or beside H2, H4 and H5. H4 gives `factory_context(agent)` its meaning, and H6's lessons page becomes one more resource. S1 should not wait for the independent review loop; it has no merge power.

## After the HumanLayer check

`docs/HUMANLAYER-VERIFIED.md` merged after this assessment. It does not mention MCP, so it gives no design to copy, but it supports the verdict:

- **Approvals stay with a person.** Their approvals happen inside the session or app at fixed points, and auto-advance never crosses design to outline or outline to implementation (row 1 of its table). That matches "no approve or answer tool".
- **Execution stays near the code.** Their sessions run on a daemon on any host, survive suspend, and are marked failed but resumable after a missed heartbeat (row 9). That is the start-and-poll shape, and our Actions lanes and sweep already play that part. A remote factory service would be a copy of their hosted app and cloud, which is the cost S3 has to justify.
- **Agents never set ready states** (row 6). Added to the guardrails above.
- **Per-agent inputs and a precedence order** (row 7, H4) turn `factory_context` into `factory_context(agent)`. H6's lessons page becomes one more resource.

## Not verified here

- Claude Code's own behaviour: whether MCP prompts appear as namespaced slash commands, its tool timeout, whether it defers tool definitions to cut context, and its approval prompt for a project-scoped server.
- Any other client (Claude Desktop, IDE extensions).
- A private-registry install on a clean machine; Windows paths.
- Remote hosting, OAuth, and the experimental tasks mechanism against a real client.
- A real project using it for a week. All numbers are from one machine and one sample project.
