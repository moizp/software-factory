# Handoff Skill

How work moves between sessions without losing its place. A session ends (context full, machine replaced, job killed, a question waiting for a person) and a fresh one, human or model, must be able to continue from the file alone.

## Two kinds

| | Who writes it | Where | When |
|---|---|---|---|
| Factory handoff | The orchestrator, from the saved workflow state (no model, no tokens) | `workflows/<id>.handoff.md`, next to the state; uploaded with it as an Actions artifact; shown in a collapsed block on the issue when a routed run fails | Whenever a workflow ends without completing: waiting for an answer, token budget, `--until` stop, failure |
| Writer handoff | The writer session, with `/handoff` | `HANDOFF.md` at the root of the branch | When a task will continue elsewhere or later |

A requeued job does not need a file: the sweep records which run died, and the next job restores that run's saved state and carries on (see `docs/CLOUD-RUNNERS.md`).

## Flow

```
stopping?
  ├─ factory run ─▶ nothing to do, the handoff file is already written
  ▼ writer session
/handoff ─▶ write HANDOFF.md (format below) ─▶ commit it to the task branch only ─▶ push
  ▼
new session: /resume-handoff
  ▼
branch and commit match the file?
  ├─ no ─▶ report the difference, ask before continuing
  ▼
read Next steps ─▶ do them ─▶ keep the file current while the task continues
  ▼
task done ─▶ delete HANDOFF.md (the PR text check fails a PR that contains it)
```

## Writer format

Front matter first, then short sections. Aim for under 60 lines; link, do not paste.

```markdown
---
branch: feature/user-auth
commit: 4f2a9c1
status: paused
written_at: 2026-10-18T22:00:00Z
resume: read Next steps, then run npm test
---
# Handoff: user auth

## Task
One or two sentences, with the issue or PR link.

## Status
What is done, what is half done, what has not started. One line each.

## Files that matter
The two or three files to read first, with `file:line` for the exact spot.

## Changes so far
Commits since main, one line each, and anything uncommitted.

## Decisions
What was decided and why, including what was rejected.

## Learnings
Things that cost time: a command that fails, a trap, an assumption that turned out wrong.

## Next steps
Numbered, concrete, in order. The first one can be started without reading anything else.
```

## Rules

- Write what the next session cannot see in the repo. Do not restate the diff.
- Facts only: commands that were run and what they showed, not what should work. Mark a guess as a guess.
- No secrets, tokens or personal data. The file is committed.
- The commit in the front matter is the commit the file describes. If you commit again, update it or say what changed.
- Update the file at the end of every session. A stale handoff is worse than none.
- `HANDOFF.md` stays on the task branch. It is deleted before the PR is merged.
