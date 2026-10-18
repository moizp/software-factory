---
description: Write HANDOFF.md so a fresh session can continue this task
argument-hint: [anything the next session must know]
allowed-tools: Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git rev-parse:*), Read, Write
---

Write `HANDOFF.md` at the root of the repository, following `.claude/skills/handoff.md`. The reader is a session that knows nothing of this conversation.

Branch: !`git branch --show-current`
Commit: !`git rev-parse --short HEAD`
Uncommitted: !`git status --short`
Commits since main: !`git log origin/main..HEAD --format=%h\ %s`

Extra notes from the user: $ARGUMENTS

1. **Check the facts first.** Run the checks you would run next (`git status`, the tests that matter) so Status says what is true now, not what you remember.
2. **Write the file** with the front matter (`branch`, `commit`, `status`, `written_at`, `resume`) and the sections Task, Status, Files that matter (with `file:line`), Changes so far, Decisions, Learnings, Next steps. Under 60 lines. Link instead of pasting.
3. **Leave out** anything visible in the diff, anything that is a guess presented as fact, and every secret.
4. **Do not commit it** unless the user asks. When they do, commit only `HANDOFF.md` with `chore: add handoff note` on the task branch and never on `main`. Remind them that the file must be deleted before the PR is merged.
5. **Report** the path, the commit it describes, and the first line of Next steps.
