# Look and Feel Skill

A project decides how its product looks, feels, moves, sounds and speaks, once, against its mission, and development follows it. This goes deeper than branding. Colours and fonts are one layer of six: the others are the materials the interface seems made of, how it moves, whether and how it sounds, how interaction feels, and the tone of its words. A product whose layers disagree (a calm mission with snappy bouncing, chiming controls) feels untrustworthy without anyone saying why.

## Where it lives

`LOOKFEEL.md` at the project root (override with `FACTORY_LOOKFEEL_FILE`), written after `MISSION.md` (`.claude/skills/mission.md`). Start from `templates/project/LOOKFEEL.md`. Check it with `npm run lookfeel:check`; it is checked against the mission when there is one. It is a protected path in the merge policy: changing the look and feel is a decision, so a person merges it.

## The six layers

| Layer | Decides |
|---|---|
| Direction | The design language (and at most one secondary to borrow a layer from), and why it serves the mission |
| Tone | Voice, words we say, words we avoid |
| Materials | What surfaces feel made of, light and depth, texture, shape |
| Colour and type | The palette (hex values) and the typefaces and their roles |
| Motion | Character, timing, what never animates, what happens under reduced motion |
| Sound | Whether there is sound, its character, exactly when, and how a person turns it off |
| Interaction feel | Rhythm and density, how actions are acknowledged, how input is received |

## Choosing

```
MISSION.md exists? ─ no ─▶ /mission first
  ▼
/lookfeel (interview, one question at a time)
  ├─ who uses it, where, when, on what, in what mood, how noisy is their world
  ├─ three or four feelings from the list (calm, warm, precise, playful, bold, luxurious, natural,
  │   handmade, trustworthy, energetic, futuristic, heritage, raw, communal)
  └─ limits: existing brand, platform, performance, accessibility, culture
  ▼
npm run lookfeel -- shortlist calm,handmade,trustworthy     (five candidates by shared feeling)
  ▼
three finalists: what each would mean for materials, motion and sound, and what each risks for this mission
  ▼
choose Primary (and at most one Secondary); write Why citing behaviour changes (BC1) and goals (G1)
  ▼
fill the six layers with values ─▶ npm run lookfeel:check ─▶ PR merged by a person
```

The catalogue has 34 design languages, from Wabi-Sabi to Biomorphic. `npm run lookfeel -- catalogue` lists them with their feelings; `npm run lookfeel -- catalogue "Wabi-Sabi"` describes one in terms of materials, form, colour, motion, sound, interaction and what to take care over. A style outside the catalogue is allowed as `Custom: <name>`, with its layers spelled out.

## Format

```markdown
# Look and feel

## Direction

- Primary: Scandinavian Design
- Secondary: Japandi
- Why: BC1 and BC2 need people to act quickly and calmly while dealing with money, so the product should feel light, orderly and trustworthy (G1: a clear invoice email)

## Tone

- Voice: Plain and friendly, like a capable colleague. Short sentences, no hype.
- Say: invoice, paid, reminder sent, due Friday
- Avoid: exclamation marks, jargon, blame in overdue messages

## Materials

- Surfaces: Matte paper-white cards on a pale birch tone, like good stationery
- Light and depth: One soft low shadow level, no glow, no gradients
- Texture: Flat with a faint paper grain on the page background only
- Shape: 6px corners, 1px hairlines, 8px spacing grid, generous margins

## Colour and type

- Palette: Paper #f6f3ee, Ink #1f2a2e, Teal #3f6b6a, Brass #b08d57, Sage #8a9a8b
- Type: Inter for interface text, a humanist serif for invoice totals only

## Motion

- Character: Quick and gentle, things slide a short way and settle
- Timing: 150 to 300 ms ease-out, no bounce
- Never animate: amounts, totals and anything the person is reading
- Reduced motion: transitions become instant fades of 100 ms

## Sound

- Use: A single soft sound when an invoice is sent or paid, nothing else
- Character: A short, dry wooden tap, quiet
- Moments: Invoice sent, invoice paid
- Control: Off by default; a switch in settings turns it on, and the system mute is always respected

## Interaction feel

- Rhythm: One main action per screen with room around it
- Feedback: A quiet inline confirmation near the thing that changed; undo for ten seconds
- Input: Large touch targets, full keyboard support, visible focus
```

What the checker enforces: every section and line above present and not just a few words; the primary (and secondary) style in the catalogue, not the same one twice; with a mission, a Why that cites a behaviour change or goal it has; at least three hex colours, two of which reach a 4.5:1 contrast ratio (WCAG AA for text); when there is sound, a Character, the Moments, and a Control that says how it is turned off; no template placeholders. It advises when a palette has more than eight colours, an animation is longer than 700 ms, or the style is a Custom one.

## Rules

- **Values, not adjectives.** "Warm and modern" cannot be built or reviewed. "6px corners, #1f2a2e on #f6f3ee, 150 to 300 ms ease-out" can.
- **The mission leads.** The style serves the behaviour changes; where it fights a task (ornament in the way of a form, slow motion on a frequent action), the task wins and the layer is adjusted, not the mission.
- **One primary, at most one secondary.** A secondary lends one layer (say its materials or its tone), not everything.
- **Accessibility is a floor, not a style.** Contrast, readable type, reduced motion, keyboard use and a way to silence every sound hold in every style.
- **Sound is optional and never a surprise.** No sound is a valid, often best, choice. If there is sound: few moments, quiet, no autoplay, always controllable.
- **Take principles, not sacred or ethnic imagery.** Several languages in the catalogue come from living cultural and religious traditions. Use their proportion, rhythm, materials and restraint. Do not paste motifs, calligraphy or sacred symbols in as decoration, and credit the source where it shaped the work.
- **Do not mix more than two.** A third is usually an absent decision.

## How development follows it

| Where | What happens |
|---|---|
| Workflow start | `LOOKFEEL.md` is read into the workflow, checked against the mission. An unusable file stops the run. A missing file only adds a note, unless `FACTORY_REQUIRE_LOOKFEEL=1`, which stops the run |
| frontend-engineer | Receives `lookfeel` and the catalogue's description of the chosen styles. Must use the declared values as tokens, build sounds only for the declared moments with the declared control, honour reduced motion, and return `look_and_feel`: how its work follows style, materials, motion, sound and interaction, and any deviations. A reply that skips this is asked again |
| customer-support | Receives `lookfeel` and writes every document in its tone |
| reviewer | Receives `lookfeel`; checks the interface and words against it and judges the deviations |
| Interactive work (you) | `/lookfeel-check` before and after UI work; `/lookfeel` to decide or revise |

## Changing it

A change to `LOOKFEEL.md` is a PR with a reason, merged by a person. Agents do not edit it. Departing from it for one piece of work is a deviation named in the PR, not a reason to change the file; changing the mission or its goals is a reason to revisit it.
