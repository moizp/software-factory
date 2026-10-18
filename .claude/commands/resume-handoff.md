---
description: Continue a task from HANDOFF.md, after checking it still matches the branch
argument-hint: [path to the handoff file, default HANDOFF.md]
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git rev-parse:*), Read, Glob, Grep
---

Continue the task described in a handoff file. Path (default `HANDOFF.md`): $ARGUMENTS

Branch: !`git branch --show-current`
Commit: !`git rev-parse --short HEAD`
Uncommitted: !`git status --short`

1. **Read the file** completely. If it does not exist, look for `workflows/*.handoff.md` (a factory run's handoff) and say which you found. If there is none, say so and stop.
2. **Compare it with reality.** The front matter names a branch and a commit. If the branch differs, or the file's commit is not an ancestor of HEAD (`git merge-base --is-ancestor <commit> HEAD`), or there are uncommitted changes the file does not mention, report each difference and ask before doing anything.
3. **Check Status against the code**, not against the file. Open the files under "Files that matter". If something the file calls done is not, say so.
4. **State the plan** in two or three lines: the first Next step and what you will check when it is done.
5. **Do the first Next step**, then continue down the list. Stop and ask when a step depends on something the file does not explain.
6. **Keep the file current**: at the end, update Status, Next steps and the commit in the front matter (use `/handoff`).

For a factory handoff, the front matter has a `resume:` command. Run it only after reading "Why this stopped"; a failure needs its cause fixed, not a blind retry.
