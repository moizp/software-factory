# Core Principles Skill

Five principles shape how the factory works and what every project built with it is held to. Each one below says what it means in practice, where it is enforced, and what is not enforced yet. A rule that only lives in a prompt is a request; a rule in code is a guarantee. This page is honest about which is which.

## 1. Human-centric augmentation over total automation

The factory augments people. It does not replace their judgement, and it does not ask them to trust it.

| Rule | Enforced by | Status |
|---|---|---|
| People are the strategic directors; agents are tactical executors | Agents never approve a PR; a person merges anything on a protected path; `needs_human` pauses a run | Built |
| Adversarial scepticism about generated code | The reviewer must list what it tried to find wrong (`review.challenges`) and what it could not check; the contract rejects a review without it | Built |
| Approval checkpoints before critical actions | A person approves the architect's plan before anything is built, by default (`FACTORY_PLAN_APPROVAL=0` skips it); a person merges every code change, because the policy has no rule that merges code on an agent's verdict; protected paths need a person; `Mission exception:` and `needs-human` stop the router | Built. The exemption for the smallest changes comes with the tier table |
| Care in every layer, including the unseen ones | Builder and reviewer prompts name errors, logs, migrations and comments that say why | Prompt only |
| Autonomy never grows silently | The planned merge worker merges docs-only PRs and nothing that touches code; after a merge the router only proposes the next items and a person picks (`docs/NEXT-CAPABILITIES.md`) | Documented, not built |

## 2. Architectural integrity: deep modules and system health

Code is not cheap. Generating more of it into a mess makes the next change harder, and models do worse in messy codebases.

| Rule | Enforced by | Status |
|---|---|---|
| Deep modules with small stable interfaces | The plan must list `modules`, each with at most 7 interface entries, what it hides, and boundary tests; the parser rejects a plan without them; the reviewer checks code against them | Built (plan); review is prompt only |
| Small steps | A plan phase has at most 15 files and must carry an automated check; a phase with no test file shows "No test file is planned" to the person approving | Built |
| Features and futures | The plan must say what refactoring, simplification or de-duplication it saw (`futures`, empty when none) and shows it to the person approving | Built; nothing yet alternates feature and future work on the board |
| Not a spec compiler | The factory keeps the plan and the code both under review, and has a change mode on its list (`docs/NEXT-CAPABILITIES.md`) so existing code is changed and not regenerated | Change mode not built |

## 3. Alignment, shared understanding, co-evolution

| Rule | Enforced by | Status |
|---|---|---|
| Reach shared understanding before planning ("grill me") | `/grill` walks the design tree with a person, writes the decisions as wiki records and the dialogue as a linked page (`.claude/skills/grill.md`); the product manager asks with `needs_human` when a brief is ambiguous | Interactive command built; a pipeline alignment stage is not |
| A ubiquitous language | The glossary in `docs/wiki/glossary.md`, decided after character and look and feel (`/language`, `.claude/skills/ubiquitous-language.md`); a current glossary is handed to the agents, who must use its terms and avoid the listed words; the reviewer is shown every avoided word that appears | Built |
| Tools and human systems co-evolve | The plan must list `assumed_changes` (roles, workflows, skills, protocols the plan depends on), and the person approving sees them; the reviewer does not approve work that depends on a change nobody agreed to | Built |

## 4. Tight feedback loops and continuous learning

| Rule | Enforced by | Status |
|---|---|---|
| Small testable steps; test first | Plan phases are small and carry a check; builders write each module's boundary tests with its code | Prompt and plan shape. The agents cannot run code, so nothing in the pipeline runs the tests before review (see the contradictions in `docs/NEXT-CAPABILITIES.md`) |
| Learning over one-shot specification | The loop is plan, approve, build, review, learn; mission signals are read after release (planned) | Partly built |
| A dynamic knowledge repository | The wiki (`.claude/skills/wiki.md`): structured, hyperlinked, every page with Status, Last verified and Sources; decisions and dialogue are captured as pages; `wiki:check` warns about long pages that link to nothing | Built |

## 5. Value beyond superficial metrics

| Rule | Enforced by | Status |
|---|---|---|
| Measure the mission, not output | Mission signals are about what users do; the mission check warns on a signal that counts our own output (lines of code, commits, pull requests, tokens, velocity); the product manager is told the same | Built |
| Do not trust what is easy to count | The reviewer is told never to treat volume, token spend or coverage percentage as evidence of value; coverage is a floor, not a target | Prompt only |
| Unquantifiable qualities count | The character and look and feel declare delight, care and feel as values and moments; the product manager adds a sentence on the quality that cannot be counted | Built |
| Cost is a limit, not a goal | `FACTORY_MAX_TOKENS` stops a runaway; `report:usage` shows cost and is not a productivity measure | Built |

## Using this page

- Starting a project: decide the mission, then character, then look and feel, then the language (`/mission`, `/character`, `/lookfeel`, `/language`), then run `/grill` on the first piece of work.
- Reviewing work: ask whether each principle's rule held, and read the status column honestly. "Prompt only" means a person should check.
- Changing a principle's enforcement is a PR with a reason, merged by a person.
