---
description: Check UI work, copy or a design against the project's declared look and feel
argument-hint: <files, a diff, a PR number, or a description of the work>
allowed-tools: Read, Glob, Grep, Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(npm run lookfeel:*)
---

Check this work against the declared look and feel: $ARGUMENTS

Branch: !`git branch --show-current`

1. **Read `LOOKFEEL.md`** (and `MISSION.md` if it exists). If there is no look and feel file, say so and stop; point to `/lookfeel`. Run `npm run lookfeel -- catalogue "<the Primary>"` for what the style means in practice.
2. **Read the work.** For a PR number use the GitHub tools; for files read them; for a branch use `git diff origin/main...HEAD`. Look at styles, tokens, components, animations, audio code and the user-facing words.
3. **Check each layer, quoting the declared value and the evidence in the work:**
   - Tone: do labels, empty states and errors use the voice, say what it says, avoid what it avoids?
   - Materials: surfaces, depth, texture, corner radius, spacing against the declared Shape.
   - Colour and type: only palette colours, declared families and roles; text contrast of at least 4.5:1.
   - Motion: timings and easing as declared; nothing animates that must stay still; `prefers-reduced-motion` handled as declared.
   - Sound: only at the declared moments, in the declared character, off or mutable as declared, no autoplay.
   - Interaction feel: rhythm, feedback and input as declared; keyboard use and focus visible.
4. **Report per layer**: `follows`, `deviates` (with file and line and the declared value) or `not touched`. Then the three deviations that matter most and a fix for each.
5. **Do not change anything.** A deviation may be justified; say what it would need to be (a named deviation in the PR). Never edit `LOOKFEEL.md`.
