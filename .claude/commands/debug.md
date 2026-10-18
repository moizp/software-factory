---
description: Find the cause of a failure before changing anything, then fix it with a test that fails first
argument-hint: <error message, failing test, or what you observed>
allowed-tools: Read, Glob, Grep, Edit, Write, Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git blame:*), Bash(npm test:*), Bash(npm run build:*), Bash(npx jest:*), Bash(npx tsc:*)
---

Debug this: $ARGUMENTS

Do not edit code until step 4. A fix without a cause is a guess that may hide the bug.

1. **Reproduce.** Run the smallest command that shows the failure (one test file with `npx jest <file>`, one build step). Record the exact output. If it does not fail, say so and ask for the missing detail (version, input, environment); do not invent a cause.
2. **Narrow.** Find where the wrong value or the wrong step first appears. Read the code on the path from the input to the failure. Use `git log -p -S"<text>" -- <file>` and `git blame` to see what changed recently. Check the obvious first: the Node version (`engines` in package.json), a missing build step, stale generated files, environment variables, a path that depends on the working directory.
3. **State the cause** in one or two sentences, with the file and line, and the evidence (the output or the code that proves it). Mark anything you did not verify as a guess. If there are two plausible causes, say how to tell them apart and test that first.
4. **Write the test that fails for that reason**, run it, and see it fail with the output from step 1 or a clear equivalent. If you cannot write one, say why.
5. **Fix the cause**, in the smallest change that makes that test pass. Do not refactor around it, change unrelated behaviour, or loosen a check to get green. Never skip or disable a test.
6. **Run the checks**: the new test, then `npm run build && npm test`. Report the numbers.
7. **Report** in this order: the cause, the evidence, the fix, the test, what was run and its result, and anything you noticed but did not change. If the same failure survives two attempts, stop and report what you know instead of trying a third guess.

This is the writer's loop. Do not commit or push from here; use `/commit` when the user asks.
