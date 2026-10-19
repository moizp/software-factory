---
description: Decide the project's look, feel and tone against its mission, then write LOOKFEEL.md
argument-hint: [what to change, if revising]
allowed-tools: Read, Write, Edit, Glob, Bash(npm run lookfeel:*), Bash(git branch:*), Bash(git status:*)
---

Help the user decide how the product looks, feels, moves, sounds and speaks, following `.claude/skills/look-and-feel.md`. Notes from the user: $ARGUMENTS

Current branch: !`git branch --show-current`

1. **Read `MISSION.md`.** If there is none, stop and send the user to `/mission`: the look and feel is chosen against it. Say the mission, its behaviour changes and its goals back in two lines. If `CHARACTER.md` exists, read it and keep the Tone consistent with its traits, address and boundaries; if it does not, suggest `/character` first and carry on only if the user wants to. If `LOOKFEEL.md` exists, read it and say what it declares.
2. **Interview, one question at a time, waiting for each answer.** Cover: who uses the product, where, when, on what device, in what mood, and how noisy their world is; three or four feelings from `calm, warm, precise, playful, bold, luxurious, natural, handmade, trustworthy, energetic, futuristic, heritage, raw, communal`; and limits (an existing brand, platform, performance, accessibility needs, the culture of the users).
3. **Shortlist.** Run `npm run lookfeel -- shortlist <their feelings>` and read the candidates. Pick three finalists. For each, run `npm run lookfeel -- catalogue "<name>"` and tell the user in plain words what it would mean for materials, motion and sound in this product, and what it risks for this mission (the "take care" line). Name the one you would pick and why, citing behaviour changes and goals by id.
4. **Let the user choose** a Primary and at most one Secondary (to lend one layer, say which). Do not decide for them.
5. **Fill the six layers with values, not adjectives**, proposing each and asking for changes: tone, materials, colour and type (real hex values, readable pairs), motion (durations, easing, what never animates, reduced motion), sound (no sound is a good answer; if there is sound, when, how it sounds, how it is turned off), interaction feel. Never invent facts about the users.
6. **Write `LOOKFEEL.md`** from `templates/project/LOOKFEEL.md`, then run `npm run lookfeel:check`. Fix every error. Read each piece of advice to the user and ask whether to act on it.
7. **Take care with cultural styles.** Use the principles (proportion, rhythm, materials), never sacred or ethnic motifs as decoration; say so when a chosen style comes from a living tradition.
8. **Do not commit or merge it.** A change to the look and feel is merged by a person. If asked for a PR, use `/commit` and `/describe-pr`, with the reason in the Why.
9. **Report** the chosen direction, the six layers in a line each, and anything you could not get an answer to.
