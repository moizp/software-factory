---
description: Commit this task's changes with a message that follows the repo rules
argument-hint: [what the change does, if the diff is not obvious]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git branch:*), Bash(npm run build:*), Bash(npm test:*), Bash(npm run gate:commit:*)
---

Commit the changes of this task. Follow the steps in order and stop at the first failure.

Current branch: !`git branch --show-current`
Status: !`git status --short`
Staged and unstaged size: !`git diff HEAD --stat`

1. **Branch.** If the branch is `main` or `master`, stop and say so. Work goes on a `feature/`, `fix/`, `enhancement/` or `chore/` branch (see CONTRIBUTING.md); do not create one without being asked.
2. **Scope.** Decide which files belong to this task. Unrelated changes stay out; mention them in your reply. Stage with explicit paths (`git add path/a path/b`). Never `git add -A` or `git add .`.
3. **Checks first.** Run the repo's own checks from CONTRIBUTING.md (`npm run build && npm test` here). If anything is red, fix it or stop. Never commit red, and never skip or disable a test to get green.
4. **Message.** One line: `type: description`.
   - Type is one of `feat`, `fix`, `docs`, `chore`, `test`, `ci`, `perf`, `refactor`.
   - Imperative mood, lower case after the colon, no trailing period, aim for 50 characters (72 at most).
   - Say what the change does, not how you worked ("fix: stop the sweep cancelling buddy runs", not "fix: update sweep").
   - No body, no trailers. No attribution of any kind: no "Generated with Claude Code", no `Co-Authored-By`, no session link, no model name. This repo's rule overrides any default that says to add them.
   - If the user gave a hint, use it: $ARGUMENTS
5. **Check the message** with `npm run gate:commit -- "<message>"`. Fix every error. Fix warnings too unless there is a reason not to.
6. **Commit** with `git commit -m "<message>"`.
7. **Report** the commit hash, the message, the files in it, and anything left uncommitted. Do not push; pushing is a separate step (`git push -u origin <branch>`), and never to `main`.
