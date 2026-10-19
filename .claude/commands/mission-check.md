---
description: Check a task, issue or idea against the project's mission before planning it
argument-hint: <the work, or an issue or PR number>
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git diff:*), Bash(git branch:*)
---

Check this work against the mission: $ARGUMENTS

Branch: !`git branch --show-current`

1. **Read `MISSION.md`.** If there is none, say so and stop: there is nothing to check against. Point to `/mission`.
2. **Read the work.** For an issue or PR number, read it with the GitHub tools; for a description, use it as given. For a branch, `git log origin/main..HEAD` and `git diff origin/main...HEAD --stat`.
3. **Decide, behaviour change by behaviour change.** For each BC id: does the work move it, and how? Quote the part of the work and the From and To it relates to. Do not stretch: "makes the product nicer" moves nothing.
4. **Check "Not our mission".** Does the work contradict any line? Quote both.
5. **Answer in this shape**, short:
   - Verdict: `serves BC1, BC3`, or `out of mission`, or `contradicts: <the line>`.
   - Evidence: one line per id.
   - If out of mission or contradicting: the three options (add a behaviour change with a PR to `MISSION.md`, drop it, or build it as a named one-off exception) and which you would pick, with the reason.
   - Behaviour changes the work leaves unserved, if the user is planning a whole round.
6. **Do not change anything.** Do not edit `MISSION.md`, the plan or the issue. The user decides.
