---
description: Write the pull request title and body for the current branch, checked against the PR text rules
argument-hint: [issue number or notes to include]
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git fetch:*), Bash(npm run policy:check:*), Bash(npm run gate:check:*), Bash(npm run build:*), Bash(npm test:*), Write
---

Write the title and body for a pull request from this branch to `main`. The body is the claim set the reviewer checks against the diff, so every statement must be true of this diff and every check named must have been run.

Branch: !`git branch --show-current`
Commits: !`git log origin/main..HEAD --format=%s`
Files changed: !`git diff origin/main...HEAD --stat`

If the commit list is empty, say there is nothing to describe and stop. Notes from the user: $ARGUMENTS

1. **Read the diff**, not only the commit messages: `git diff origin/main...HEAD`. For a large diff, read the files that carry the behaviour and skim the rest.
2. **Run the checks** (`npm run build && npm test`) now if you have not run them on this exact head. The Testing section may only list commands you ran and what they showed.
3. **Ask the policy** what this change is: `npm run policy:check -- --base origin/main --head HEAD --branch "$(git branch --show-current)"`. Note whether it can auto-merge or needs a human, and which paths are protected.
4. **Title.** Same format as a commit: `type: description`, lower case, no trailing period.
5. **Body**, with these headings, written to a file inside the git directory so it can never be committed (`$(git rev-parse --git-dir)/pr-body.md`):

```markdown
## What
Two to five sentences: what changes, in terms a reader can check against the diff.

## Why
The problem or the request. Link the issue with `Closes #123` if there is one.

## Out of scope
What this deliberately does not touch. Say "nothing" if that is true.

## Risk
R0, R1, R2 or R3 (R3 touches security, money, data or workflows), and the reason in one line.

## Testing
Each command you ran with its result, such as `npm test`: 418 passed. Add manual checks. Say what was NOT run and why.

## Rollback
How to undo it safely. For most changes: revert the merge commit. Name anything a revert does not undo (data, issues, labels, secrets).
```

5b. **Interface changes.** If the diff touches components, pages, styles or other interface files, add an `## Evidence` section with the before and after pictures from `npm run evidence:capture` and `npm run evidence:publish` (`.claude/skills/visual-evidence.md`), or `Not applicable: <reason>`. `gate:check` fails an R2 or R3 change that has neither.
6. **Check the text**: `npm run gate:check -- --base origin/main --head HEAD --branch "$(git branch --show-current)" --title "<title>" --body-file "$(git rev-parse --git-dir)/pr-body.md"`. Errors must be fixed. Warnings should be fixed: remove em dashes, filler and chatbot phrasing, and add the missing evidence it names.
7. **Rules for the text.** No attribution lines of any kind (no "Generated with Claude Code", no session or model links, no `Co-Authored-By`). Plain sentences, no em dashes, no marketing words. Do not claim anything you did not verify; "not run" is an acceptable and honest answer.
8. **Show** the title and the body. Create the pull request only if the user asked for it. If a tool adds a footer or link to the body when creating the PR, edit the PR afterwards and remove it.
