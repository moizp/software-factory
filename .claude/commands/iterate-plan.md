---
description: Change an existing implementation plan after feedback, without rewriting what was approved
argument-hint: <path to the plan, or the plan's name> and the feedback
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(git diff:*), Bash(git status:*)
---

Update an implementation plan from feedback. A plan is the thing a person reviews before code is written, so the change must be easy to review: small, local, and explained.

Input: $ARGUMENTS

The plan can be a markdown file (look in `docs/`, `plans/` or the path given), or the `implementation_plan` of a factory workflow state under `workflows/`. If you cannot tell which plan is meant, list the candidates and ask; do not guess.

1. **Read** the whole plan and the feedback. Restate the feedback in one line per point so a mistake in reading it shows before you edit.
2. **Check the feedback against the code.** Open the files the plan names. If the feedback depends on something that is not true in the code, say so and do not build the plan on it.
3. **Change only what the feedback touches.** Keep phase names, order and wording that were not criticised: the reviewer approved those. If a change forces another phase to move, say why in the summary.
4. **Keep the plan's shape.** Every phase has a name, a goal, the files it creates or changes (relative paths, complete), automated checks (real commands) and manual checks (what only a person can judge). Every phase needs at least one check. If a phase grows past what a person reads in a minute, split it.
5. **Do not widen the scope** to cover things nobody asked for. If you notice a gap, list it under "Noticed, not changed" and let the person decide.
6. **No code in this step.** Editing the plan is the whole job. Do not start the build.
7. **Report** as a short list: what changed in the plan (phase and field), what you left alone on purpose, what you noticed but did not change, and the question you still need answered, if any. Then ask for approval of the revised plan.

For a factory workflow, answer the plan question instead of editing state by hand: `factory answer <workflow-id> "<the changes>"` makes the architect revise, and `factory answer <workflow-id> approve` starts the build.
