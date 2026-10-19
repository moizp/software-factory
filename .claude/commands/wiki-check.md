---
description: Check the project wiki for errors, stale pages and drift from its sources
argument-hint: [page or area to look at]
allowed-tools: Read, Glob, Grep, Bash(npm run wiki:*), Bash(git log:*), Bash(git diff:*), Bash(git branch:*)
---

Check the project wiki following `.claude/skills/wiki.md`. Focus: $ARGUMENTS

1. **Run the checks.** `npm run wiki:check` and `npm run wiki -- drift`. If there is no wiki, say so and point to `/wiki`.
2. **Errors first.** For each error say what is wrong and the exact fix (regenerate the index, fix the link, add the missing line, remove the secret and say it must be rotated).
3. **Stale and drifted pages.** For each page the checks flag, read its `Sources:` and `git log` for the changes since `Last verified`. Say whether the page is still true, partly wrong, or unknown, quoting the line that is affected. Do not change `Last verified` yourself in this command.
4. **Gaps.** From recent merged work (`git log --oneline -30`), name decisions or new concepts with no page, as a short list: subject, why it deserves a page, the source.
5. **Do not change anything.** Report as a table: page, finding, evidence, suggested fix. Offer to run `/wiki` for the pages that need work.
