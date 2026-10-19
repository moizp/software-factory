# Mission Skill

A project that uses the factory declares its mission: what we are trying to achieve together with our users, and the behaviour changes we expect in them. Planning work is then held to it. A feature is justified by the behaviour change it moves, not by being asked for.

## Where it lives

`MISSION.md` at the root of the project (override with `FACTORY_MISSION_FILE`). Start from `templates/project/MISSION.md`. Check it with `npm run mission:check`. It is a protected path in the merge policy: changing the mission is a decision, so a person merges it.

## Format

```markdown
# Mission

Independent freelancers get paid on time without spending their evenings on admin.

## Users

- Freelancers and very small agencies: invoice by hand in spreadsheets and chase payments by email

## Behaviour changes

### BC1: Invoice at the moment of delivery
- Who: freelancers with fewer than ten clients
- From: they batch invoices at month end, often days late
- To: they send the invoice the same day they deliver the work
- Signal: share of invoices sent within one day of the project's last delivery, from 20% to above 60%

### BC2: Stop chasing by hand
- Who: freelancers whose clients pay late
- From: they write reminder emails themselves
- To: they let the product remind clients and only step in after the second reminder
- Signal: reminder emails sent by hand per month, falling by more than half

## Goals

- Clients can pay straight from the invoice email in two taps
- Everything a freelancer enters can be exported at any time

## Not our mission

- Accounting, tax filing or payroll
- Teams larger than fifty people
```

Rules the parser enforces: a mission statement of 20 to 600 characters; at least one user group; one to eight behaviour changes, each `### BCn: name` with Who, From, To and Signal; From and To must differ; no template placeholders left. `## Goals` is optional: up to six secondary aims that are not behaviour changes (a quality to protect, a promise to keep), as plain bullets; they are numbered G1, G2 and so on in order. A goal never justifies work by itself and never rules it out: a feature must still serve a behaviour change, and planners prefer, among features that do, the ones that also advance a goal. Look and feel is decided against the mission and its goals (`.claude/skills/look-and-feel.md`). The parser only advises (warnings) when "To" starts with a work verb such as "add" or "build", when a Signal names nothing countable, or when there is no "Not our mission" list.

## Telling the router (issues)

Issues that start agent work (the `agent:ready` label) must say which behaviour change they serve, before any agent runs. In the issue body, on its own line:

```text
Serves: BC1
Serves: BC1, BC3
Mission exception: the old export format is removed by the provider in March
```

The router reads these lines. An issue with neither waits, with a comment that lists the project's behaviour changes and what to add; re-apply the label after editing. An id the mission does not have, an unreadable line, or an exception with no reason (at least 10 characters) waits too. `task:review`, `task:gate` and `task:triage` issues are exempt, because they plan no product work. A project without a `MISSION.md` is not checked, unless `FACTORY_REQUIRE_MISSION` is on. The router checks that the issue says so, not that it is true: the product manager holds it to it. If the issue says `Serves: BC2`, some feature must serve BC2. A `Mission exception:` tells the product manager a person already decided, so it does not ask again and a must-have may sit outside the mission. `templates/project/ISSUE_TEMPLATE/agent-task.md` has the line ready.

## Writing a good one

- **Behaviour, not features.** "Users export their data" is a feature. "Accountants stop retyping figures into their own sheets" is a behaviour change. If the To line starts with "add" or "build", it is a task.
- **From and To are things a person does.** You should be able to watch someone do the From today.
- **A Signal you could count.** A rate, a number, a time, or an observable event. If nobody could tell whether it happened, it steers nothing.
- **Few.** Two to four. Each one is a reason to say no to something else.
- **Say what is out.** The "Not our mission" list is what turns an idea into "out of mission".
- **Interview, do not invent.** Ask the people who know: who are the users, what do they do today that we want to change, what would we see if it worked, what will we refuse to build. `/mission` runs that interview. Never fill in a mission from a guess.

## Flow

```
new project or adoption
  ▼
/mission (interview) ─▶ MISSION.md ─▶ npm run mission:check ─▶ PR, merged by a person
  ▼
work is proposed (issue, brief, idea)
  ▼
/mission-check <the work>      (factory agents get the mission automatically)
  ├─ moves a behaviour change ─▶ name it: "serves BC1" in the plan and the PR's Why
  ├─ moves none ─▶ out of mission ─▶ ask the person: add a behaviour change (a PR to MISSION.md),
  │                                  drop it, or build it as a named one-off exception
  └─ contradicts "Not our mission" ─▶ stop and ask; never plan it quietly
  ▼
after release: look at each Signal ─▶ update MISSION.md when a change is achieved, abandoned,
                                       or users turned out to do something else
```

## What the factory does with it

| Where | What happens |
|---|---|
| Router (`route.yml`) | Before choosing a lane or spending a token, an issue must carry a `Serves:` or `Mission exception:` line (see above); otherwise it waits with the choices in a comment |
| Workflow start | `MISSION.md` is read into the workflow. An unusable file stops the run. A missing file only adds a note, unless `FACTORY_REQUIRE_MISSION=1`, which stops the run |
| product-manager | Receives `mission`. Each must-have and nice-to-have feature must say which behaviour changes it `serves`, or be listed as out of mission with a reason; a must-have cannot be out of mission. An out-of-mission request in the brief becomes a question to a person. Checked by the contract: a reply that skips this is asked again |
| analyzer, software-architect | Receive `mission`. Every phase of the architect's plan says which behaviour changes it serves, and the plan a person approves shows which ones the plan leaves unserved |
| reviewer | Receives `mission`; flags work that drifted from it or contradicts "Not our mission" |
| Interactive planners (you) | Use `/mission-check` before writing a plan, and `/iterate-plan` keeps the `serves` lines |

## Rules

- Agents never edit `MISSION.md` on their own. A change to it is a PR with a reason, merged by a person.
- A one-off exception is allowed and must be named as one in the PR's Why. It is not a reason to change the mission.
- When the mission and a request disagree, the request waits for a person. Do not resolve it by reading the mission loosely.
