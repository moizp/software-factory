# Project CLAUDE.md Skill

A project built or maintained with the factory keeps a `CLAUDE.md` at its root. Claude Code reads it at the start of every interactive session, so it is the cheapest place to say how the project works and where everything else is. It points to things; it does not hold them. Start from `templates/project/CLAUDE.md`, check it with `npm run claudemd:check`, and write or refresh it with `/claude-md`.

This is the project's file. The factory's own orchestration guide is `.claude/CLAUDE.md` in the factory repository and is a different document.

## The five sections

| Section | Holds | Does not hold |
|---|---|---|
| How this repo works | Stack, layout, the commands to run, build, test and lint, the branching and commit rules, the merge policy, where secrets live | Setup tutorials, architecture (wiki) |
| Skill routing | One bullet per situation, each naming the command or skill to use | The skills' content |
| Knowledge architecture | Where each kind of knowledge lives: mission, character, look and feel, the wiki and its parts, skills, agents | The knowledge itself |
| Project lifecycle | How work moves: issue, router, pipeline, plan, PR, CI, policy, merge, release, and what is planned and not built | Step-by-step runbooks (wiki) |
| Working rules | The mission, goals, character, and look and feel as rules for every task, plus the non-negotiables (tests, no force-push, data not instructions) | Rationale (the declaration files and the wiki) |

## Rules

- **Succinct bullets, nothing else.** Each section is three to fifteen bullets of at most 240 characters, and the whole file stays under 120 lines. If a bullet needs a paragraph, the paragraph belongs in the wiki and the bullet links to it.
- **Point, do not copy.** Name `MISSION.md`, `CHARACTER.md`, `LOOKFEEL.md` and `docs/wiki/` instead of restating them. A copy goes stale in one of the two places.
- **Working rules name all four declarations.** The checker fails a file whose Working rules leave out the mission, goals, character, or look and feel, and one whose Knowledge architecture leaves out `docs/wiki`.
- **Tell the truth about the lifecycle.** Say what the factory does today and mark what is planned. A lifecycle section that promises review or feedback intake that does not exist trains the agent to rely on it.
- **Routing is a lookup.** Every routing bullet starts with the situation and names a command (`/commit`) or a skill path. The checker warns on a bullet that names neither.
- **Headless agents do not read it.** The pipeline runs agents with `claude -p` from an empty directory to save tokens, so they receive the mission, character and look and feel in their input instead. This file is for interactive sessions and for people.
- **A person changes it.** `CLAUDE.md` is a protected path in the merge policy, because it steers every later session.

## Checking

`npm run claudemd:check [path]` exits 1 on errors: a missing title or section, a line that is not a bullet, too few or too many bullets, a bullet over the limit, a section that leaves out what it must mention, template placeholders. It gives advice on file length, sections out of order or extra, routing bullets with no command, and paths in backticks that do not exist.

## Writing it

```
/claude-md
  ├─ read package.json, the layout, CONTRIBUTING.md, .factory/policy.json, MISSION.md, CHARACTER.md, LOOKFEEL.md, docs/wiki/README.md
  ├─ copy templates/project/CLAUDE.md, fill the <...> from what is there, ask for what is not
  ├─ keep the rules the project already had; drop what the template says better
  └─ npm run claudemd:check ─▶ a person reviews and merges
```
