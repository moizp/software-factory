---
description: Write or refresh the project's CLAUDE.md with the five standard sections
argument-hint: [what to change, if revising]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npm run claudemd:*), Bash(git branch:*), Bash(git status:*), Bash(git log:*)
---

Write or refresh this project's `CLAUDE.md` following `.claude/skills/project-claude-md.md`. Notes from the user: $ARGUMENTS

Current branch: !`git branch --show-current`

1. **Read what exists.** The current `CLAUDE.md` if there is one (keep every rule the project already had that is still true), `package.json` scripts, the directory layout, `CONTRIBUTING.md`, `.factory/policy.json`, `docs/wiki/README.md`, and whichever of `MISSION.md`, `CHARACTER.md` and `LOOKFEEL.md` exist.
2. **Start from `templates/project/CLAUDE.md`** with its five sections, in order: How this repo works, Skill routing, Knowledge architecture, Project lifecycle, Working rules.
3. **Fill the `<...>` from the repository,** never from guesses: the real stack, layout and commands, where secrets live, how a change reaches users. Ask the user, one question at a time, for anything you cannot read from the repository.
4. **Keep it to succinct bullets.** At most 240 characters each, no paragraphs, no tables, under 120 lines. Replace explanation with a pointer to the wiki, and add the pointer target with `/wiki` if it does not exist.
5. **Point to declarations that are missing.** If `MISSION.md`, `CHARACTER.md` or `LOOKFEEL.md` does not exist, keep the rule but tell the user to run `/mission`, `/character` or `/lookfeel`. Do not invent them.
6. **Be honest about the lifecycle.** Say what runs today and keep the "planned, not built" bullet for independent agent review, feedback intake and release steps the project does not have.
7. **Check it.** Run `npm run claudemd:check`. Fix every error; read each piece of advice to the user.
8. **Do not commit or merge it.** `CLAUDE.md` is a protected path: a person merges it. If asked for a PR, use `/commit` and `/describe-pr`.
9. **Report** what you filled in from the repository, what you asked the user, and anything left open.
