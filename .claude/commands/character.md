---
description: Decide the project's character against its mission, then write CHARACTER.md
argument-hint: [what to change, if revising]
allowed-tools: Read, Write, Edit, Glob, Bash(npm run character:*), Bash(git branch:*), Bash(git status:*)
---

Help the user decide who the product is as a someone, following `.claude/skills/character.md`. Notes from the user: $ARGUMENTS

Current branch: !`git branch --show-current`

1. **Read `MISSION.md`.** If there is none, stop and send the user to `/mission`: the character is chosen against it. Say the mission, its behaviour changes and its goals back in two lines. If `CHARACTER.md` exists, read it and say what it declares.
2. **Interview, one question at a time, waiting for each answer.** Cover: who the users are and what state they are in when they use the product; what they fear going wrong; three or four feelings from `calm, warm, precise, playful, bold, luxurious, natural, handmade, trustworthy, energetic, futuristic, heritage, raw, communal`; and limits (an existing brand voice, the culture and language of the users, moments that are regulated or high stakes).
3. **Shortlist.** Run `npm run character -- shortlist <their feelings>`. Pick three finalists. For each, run `npm run character -- catalogue "<name>"` and tell the user in plain words how it would behave at the hard moments in this product (a mistake, a failure, a refusal) and what it risks for this mission (the "take care" line). Name the one you would pick and why, citing behaviour changes and goals by id.
4. **Let the user choose** a Primary and at most one Secondary (to lend one trait or stance, say which). Do not decide for them.
5. **Fill the layers with behaviour, not adjectives**, proposing each and asking for changes: three to five traits as "trait, not opposite", two to four values as "this over that", the relationship, every moment (ask what should happen in the product's own worst moment before anything else), and the boundaries. Never invent facts about the users.
6. **Write `CHARACTER.md`** from `templates/project/CHARACTER.md`, then run `npm run character:check`. Fix every error. Read each piece of advice to the user and ask whether to act on it.
7. **Tell the user the next step:** `/lookfeel`, whose tone must agree with this character. If `LOOKFEEL.md` already exists, read its Tone and say where it disagrees.
8. **Do not commit or merge it.** A change to the character is merged by a person. If asked for a PR, use `/commit` and `/describe-pr`, with the reason in the Why.
9. **Report** the chosen archetype, the traits in a line, the moments in a line each, and anything you could not get an answer to.
