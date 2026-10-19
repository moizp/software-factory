# Grill Skill

Reach a shared design concept before writing a plan or any code. A person and the model question each other until both can say the same thing about what is being built, for whom, why, and what is out. Nothing is planned until the person confirms the summary.

## When

- Before the first plan of a project, and before any piece of work that is not a small fix.
- When a brief is vague, when two people describe the same thing differently, when the model catches itself guessing.
- Not for typos, one-line fixes or work whose design is already written down in the wiki.

## How it runs

```
/grill <topic>
  ▼
read MISSION.md, CHARACTER.md, LOOKFEEL.md, the glossary, docs/wiki/README.md, then the code the topic touches
  ▼
ask one question at a time, walking the design tree from the root; for each, offer your recommended answer and why
  │   root:  who is this for, what do they do today, what should they do instead (which behaviour change)
  │   then:  the main flow, the failure flows, the data, the boundaries between parts, the words
  │   always: what would make us wrong, what we are not building, who has to change how they work
  ▼
a question the code or the wiki can answer is answered by reading, not asked
  ▼
say back the design concept in a page or less: purpose, users, behaviours, parts and interfaces, terms, rejected options, risks, assumed changes to people and process
  ▼
the person corrects it ─▶ repeat until they say it is right
  ▼
write it down ─▶ decisions as wiki records, new words in the glossary, the dialogue as a linked wiki page ─▶ then plan
```

## Rules

- **One question at a time,** waiting for the answer. Each question has a recommendation so the person can say "yes" or correct it.
- **Walk the tree, do not survey it.** Settle a decision before the ones that depend on it.
- **Challenge, kindly.** If an answer conflicts with the mission, the character, an earlier answer or the code, say so and ask which wins.
- **Terms are decisions.** When a new word appears, add it to the glossary with its avoid words, or ask which existing word it is.
- **Name the human-system changes.** If the design needs a person to do something differently (a role, a workflow, a skill, a protocol), say it plainly and record it as an assumed change.
- **Nothing silently assumed.** Unknowns go into the page as open questions with an owner.
- **The person decides.** The model recommends, summarises and records. It does not approve the concept for them.

## What gets written

- Each decision that is costly to reverse: `docs/wiki/decisions/NNNN-short-title.md` (Context, Decision, Consequences).
- Each new term: the glossary table, with Avoid.
- The dialogue: `docs/wiki/dialogue/YYYY-MM-DD-topic.md`, with the questions asked, the answers, what was left open and links to the decisions and pages it produced. Status `current`, Sources naming the people.
- Then run `npm run wiki -- index --write` and `npm run wiki:check`.

## What is not built yet

The grill is an interactive command. The pipeline does not yet have an alignment stage that does the same before the architect, and a phase may ask at most 3 questions, so a long grill cannot run unattended. Both are in `docs/NEXT-CAPABILITIES.md`.
