---
description: Question the design with the user until you share one concept, before any plan or code
argument-hint: <what is being designed>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm run wiki:*), Bash(npm run language:*), Bash(git log:*), Bash(git branch:*)
---

Grill the design of: $ARGUMENTS. Follow `.claude/skills/grill.md`.

Current branch: !`git branch --show-current`

1. **Read first.** `MISSION.md`, `CHARACTER.md`, `LOOKFEEL.md`, `docs/wiki/README.md` and the glossary, then the code the topic touches. Say back, in three lines, what you already understand, and what you will not ask because the files answer it.
2. **Ask one question at a time and wait.** Start at the root of the design (who it is for, what they do today, which behaviour change it serves) and walk down: main flow, failure flows, data, boundaries between parts, words. Give your recommended answer and why with every question. Challenge any answer that conflicts with the mission, the character, an earlier answer or the code.
3. **Collect terms and human-system changes as they appear.** A new word goes to the glossary with its avoid words. A needed change in how people work (a role, workflow, skill or protocol) is written down as an assumed change.
4. **Say the design concept back** in a page or less: purpose, users, behaviours, parts and interfaces, terms, rejected options, risks, assumed changes, open questions with an owner. Ask what is wrong. Repeat until the user says it is right. Do not call it agreed yourself.
5. **Write it down:** a decision record for each costly-to-reverse decision, the new terms, and a dialogue page linking them (see the skill). Run `npm run wiki -- index --write` and `npm run wiki:check`; fix every error.
6. **Stop before planning.** Offer the next step (a plan, or `/iterate-plan`), and do not start it. Do not commit or merge; if asked for a PR use `/commit` and `/describe-pr`.
7. **Report** what was decided, what was left open, and which files you wrote.
