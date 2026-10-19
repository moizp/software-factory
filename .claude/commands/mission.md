---
description: Draft or revise the project's MISSION.md by interviewing the user
argument-hint: [what changed, if revising]
allowed-tools: Read, Write, Edit, Glob, Bash(npm run mission:check:*), Bash(git branch:*), Bash(git status:*)
---

Help the user declare the project's mission in `MISSION.md`, following `.claude/skills/mission.md`. Start from `templates/project/MISSION.md`. Notes from the user: $ARGUMENTS

Current branch: !`git branch --show-current`

1. **Look first.** If `MISSION.md` exists, read it and say what it says in two lines. Read the README and any product notes only to ask better questions, never to answer them.
2. **Interview, one question at a time, and wait for each answer.** Do not write the file until you have answers to these:
   - Who are the users? What do they do today?
   - What do we want them to do differently? For each, what do they do now (From) and what would we like them to do (To)?
   - How would we see it happening (Signal)? Push for something countable.
   - What will we refuse to build, even when asked?
   - The mission in one or two sentences, in the users' terms.
3. **Challenge what you hear.** A To that starts with "add" or "build" is a task: ask what the user will do once it exists. More than four behaviour changes: ask which two matter most.
4. **Write `MISSION.md`** with the user's words, tidied but not improved into something they did not say. Never invent a user group, a number or a goal.
5. **Check it**: `npm run mission:check`. Fix every error. Read each piece of advice to the user and ask whether to act on it.
6. **Do not commit or merge it.** A mission change is merged by a person. If the user asks for a PR, use `/commit` and `/describe-pr`, and put the reason for the change in the Why.
7. **Report** the behaviour changes by id and name, and anything you could not get an answer to.
