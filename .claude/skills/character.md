# Character Skill

A project decides who its product is, as a someone, once, against its mission, and development follows it. Look and feel decides how the product looks and sounds; character decides how it behaves toward a person, above all when things are not going well: when the person makes a mistake, when the product fails, when it has to say no.

## Where it lives

`CHARACTER.md` at the project root (override with `FACTORY_CHARACTER_FILE`), written after `MISSION.md` (`.claude/skills/mission.md`) and before `LOOKFEEL.md` (`.claude/skills/look-and-feel.md`), whose tone must agree with it. Start from `templates/project/CHARACTER.md`. Check it with `npm run character:check`; it is checked against the mission when there is one. It is a protected path in the merge policy: changing the character is a person's decision.

## The layers

| Layer | Decides |
|---|---|
| Archetype | The starting shape (and at most one secondary), and why it serves the mission |
| Traits | Three to five lines, each "trait, not its opposite", with how it shows |
| Values | Two to four lines, each "this over that", for when two good things collide |
| Relationship | What the product is to the person, how it treats their skill and mistakes, how it addresses them |
| Moments | What it does at first meeting, success, the person's mistake, its own failure, saying no (and optionally waiting and leaving) |
| Boundaries | What it never does, and whether and where it uses humour |

## Choosing

```
MISSION.md exists? ─ no ─▶ /mission first
  ▼
/character (interview, one question at a time)
  ├─ who the users are, what state they are in when they use it, what they fear going wrong
  ├─ three or four feelings from the list (calm, warm, precise, playful, bold, luxurious, natural,
  │   handmade, trustworthy, energetic, futuristic, heritage, raw, communal)
  └─ limits: an existing brand voice, the culture and language of the users, regulated moments (money, health)
  ▼
npm run character -- shortlist warm,calm,trustworthy      (four candidates by shared feeling)
  ▼
three finalists: how each would behave at the hard moments in this product, and what each risks for this mission
  ▼
choose Primary (and at most one Secondary); write Why citing behaviour changes (BC1) and goals (G1)
  ▼
traits, values, relationship, moments, boundaries ─▶ npm run character:check ─▶ /lookfeel ─▶ PR merged by a person
```

The catalogue has twelve archetypes: Innocent, Sage, Explorer, Outlaw, Magician, Hero, Lover, Jester, Everyman, Caregiver, Ruler and Creator. `npm run character -- catalogue` lists them; `npm run character -- catalogue Sage` describes one. An archetype outside the list is allowed as `Custom: <name>`, with a warning to spell it out.

## Format

```markdown
# Character

## Archetype

- Primary: Caregiver
- Secondary: Sage
- Why: BC1 needs people to chase an overdue invoice without dreading it, so the product stays calm and on their side (G1: the first reminder goes out the same day)

## Traits

- Calm, not cautious: states the next step and does not hedge
- Direct, not blunt: says what happened first and what to do second
- Patient, not passive: repeats a useful hint, never nags

## Values

- Clarity over cleverness: a plain sentence beats a witty one
- The person's time over our metrics: no prompt that exists only to keep them here

## Relationship

- Role: A capable bookkeeper who works for the person
- Stance: Assumes the person knows their business; treats a mistake as a missing piece of information
- Address: "you" for the person, "we" only for things the product did together with them

## Moments

- First meeting: Asks for one thing, shows what the next three steps are
- Success: Says what changed and what happens next, in one line; no confetti
- User mistake: Says what went wrong in the product's terms, offers the fix, never says "invalid"
- Our failure: Says so first, says what is safe, says when we will tell them more
- Saying no: Gives the reason and the nearest thing it can do
- Waiting: Shows what is happening and roughly how long

## Boundaries

- Never: blame the person; use urgency to push a purchase; hide a cost
- Humour: none in money, failure or refusal moments; a dry line is fine in empty states
```

What the checker enforces: every section and line above present and not just a few words; the archetype (and secondary) in the catalogue, not the same one twice; with a mission, a Why that cites a behaviour change or goal it has; three to five traits that read "trait, not opposite"; two to four values that read "this over that"; no template placeholders left. It warns when "Never" lists fewer than two things, when the primary is Jester with no humour, and when the failure moment leans on humour.

## Rules

- **Behaviour, not adjectives.** "Friendly and professional" cannot be built or reviewed. "Says what it did before it asks for anything" can.
- **Decide the hard moments.** Anyone is pleasant when it goes well. The mistake, the failure and the refusal are where the character shows, and where a product without one is cold.
- **The mission leads.** The character serves the behaviour changes; where it fights a task (play in the way of a payment), the task wins and the character is adjusted, not the mission.
- **One primary, at most one secondary.** A secondary lends a trait or a stance, not a second personality.
- **Honesty is a floor, not a trait.** The character never deceives, never uses urgency or guilt against the person, and never hides a cost, whatever archetype it has.
- **Humour is a decision.** If it has humour it says where, and never in failure, loss or money moments.
- **Do not copy a real person or brand.** The character is the product's own. Do not model it on a living person, and do not imply a human where there is none.

## How development follows it

| Where | What happens |
|---|---|
| Workflow start | `CHARACTER.md` is read into the workflow, checked against the mission. An unusable file stops the run. A missing file only adds a note, unless `FACTORY_REQUIRE_CHARACTER=1`, which stops the run |
| frontend-engineer | Receives `character` and the catalogue's description of the chosen archetypes. Its words and states behave as the moments say, within the boundaries, and it returns `character_fit` (traits, moments, deviations); a reply that skips it is asked again |
| customer-support | Receives `character` and writes as it would, never doing what Boundaries lists |
| reviewer | Receives `character`; checks the interface's words and states against it and judges the deviations |
| Interactive work (you) | `/character-check` before and after work with user-facing words; `/character` to decide or revise |

## Changing it

A change to `CHARACTER.md` is a PR with a reason, merged by a person. Agents do not edit it. Departing from it for one piece of work is a deviation named in the PR, not a reason to change the file; changing the mission or its goals is a reason to revisit it, and then `LOOKFEEL.md`.
