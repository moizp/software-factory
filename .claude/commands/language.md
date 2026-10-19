---
description: Build or revise the project's glossary, its ubiquitous language, with the people who know the domain
argument-hint: [what to add or change]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm run language:*), Bash(npm run wiki:*), Bash(git branch:*), Bash(git status:*)
---

Help the user decide the project's shared vocabulary, following `.claude/skills/ubiquitous-language.md`. Notes from the user: $ARGUMENTS

Current branch: !`git branch --show-current`

1. **Read what exists.** `docs/wiki/glossary.md` (or start from `templates/project/docs/wiki/glossary.md`), `MISSION.md`, `CHARACTER.md`, `LOOKFEEL.md`, the product copy and the names used in the code. If the mission does not exist, send the user to `/mission` first; the words are chosen against it.
2. **Find the words by asking.** One question at a time: what does the business call its main things; what does the user call them; which two words get confused; which word do you wish nobody used. Offer terms you found in the code or copy as suggestions and ask which are right. Never invent a meaning for a domain term.
3. **For each term write** a one-sentence meaning, the words to avoid (the synonyms people reach for), and what it is not to be confused with. A term is defined once; an avoid word belongs to one term; a term is never also an avoid word.
4. **Check the character and look and feel agree.** The tone in `LOOKFEEL.md` and the address in `CHARACTER.md` must use these words.
5. **Write the table** under `## Terms` in `docs/wiki/glossary.md`, keep `Sources:` and the date honest, and set `Status: current` only once the user confirms the terms. A draft is not given to the agents.
6. **Check:** `npm run language:check` then `npm run wiki -- index --write` and `npm run wiki:check`. Fix every error; read each piece of advice to the user.
7. **Say where it still drifts:** names in the code or copy that use an avoided word. List them; do not rename anything without the user's say, because a rename is a migration.
8. **Do not commit or merge it.** If asked for a PR, use `/commit` and `/describe-pr`.
9. **Report** the terms, what you asked, what is left as a draft.
