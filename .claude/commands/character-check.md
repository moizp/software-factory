---
description: Check user-facing words, states or a design against the project's declared character
argument-hint: [file, diff or description to check]
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(npm run character:*)
---

Check this work against the declared character: $ARGUMENTS

Current branch: !`git branch --show-current`

1. **Read `CHARACTER.md`** (and `MISSION.md` if it exists). If there is no character file, say so and stop; point to `/character`. Run `npm run character -- catalogue "<the Primary>"` for what the archetype means.
2. **Find the work.** If an argument names a file, a diff or a description, use it; otherwise use `git diff` against the default branch. Pick out what a person reads or meets: labels, empty states, loading and error messages, confirmations, refusals, first-run steps, emails, help text.
3. **Check each against the character,** quoting the text and the line of `CHARACTER.md` it meets or breaks:
   - **Moments.** Does the text for a mistake, a failure, a refusal, a first meeting, a success behave as the Moments line says?
   - **Traits and values.** Does it read as the traits, and does it pick the preferred side of each value?
   - **Address.** Does it call the person and itself what Relationship says?
   - **Boundaries.** Does it do anything in Never? Is there humour where Humour says there is none?
4. **Report** a short table: item, verdict (follows, drifts, breaks), the line of `CHARACTER.md` it rests on, and the fix in the character's own words. Name what you could not judge (text that is generated at run time, other languages).
5. **Do not change anything.** A deviation may be justified; say what it would need to be (a named deviation in the PR). Never edit `CHARACTER.md`.
