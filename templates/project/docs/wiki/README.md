# Project wiki

What this project's people and agents need to know that the code does not say: what the product is for, how it fits together, why it is the way it is, and the words it uses. One page per subject. Guide: `.claude/skills/wiki.md`.

<!--
Copy this folder to docs/wiki in your project. Fill in the draft pages, change their Status to current once they are true and have Sources,
then run: npm run wiki -- index --write && npm run wiki:check
-->

## Pages

<!-- wiki:index -->
| Page | Status | What it covers |
|---|---|---|
| [Architecture overview](architecture/overview.md) | draft | The parts of the system, what each is responsible for, how data moves between them, and the constraints that shaped them. |
| [Record decisions in the wiki](decisions/0001-record-decisions.md) | current | We write down each decision that is costly to reverse, in a short numbered record, so nobody has to rediscover why. |
| [Glossary](glossary.md) | draft | The words this project uses for its own things, and what each means here, so a person or an agent reads them the same way. |
| [Product and users](product.md) | draft | Who the product is for, what they do today, and what it should change for them; the pointer to the decisions that shape everything else. |
<!-- /wiki:index -->

## How to keep it

- Add or change a page with `/wiki`. Check the whole wiki with `/wiki-check` or `npm run wiki:check`.
- Every page says its Status, when it was Last verified and its Sources. A page without sources cannot be trusted or re-checked.
- The table above is generated: `npm run wiki -- index --write`. Do not edit it by hand.
- Link to `MISSION.md`, `CHARACTER.md` and `LOOKFEEL.md` instead of copying them.
- Never put secrets, personal data or customer data here.
