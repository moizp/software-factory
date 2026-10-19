# Ubiquitous Language Skill

A project has one vocabulary. Developers, domain experts, agents and users use the same word for the same thing, and nobody uses a second word for it. The glossary is that vocabulary, kept as the table in `docs/wiki/glossary.md` so there is one glossary and it is part of the wiki. Decide it after the mission, the character and the look and feel, and before the first plan.

## Where it lives

`docs/wiki/glossary.md` (override with `FACTORY_LANGUAGE_FILE`). Start from `templates/project/docs/wiki/glossary.md`. Check it with `npm run language:check` and `npm run wiki:check`. Write it with `/language`.

```markdown
# Glossary

Status: current
Last verified: 2026-10-19
Sources: the product copy; interviews with the finance team

The words this project uses for its own things, and what each means here.

## Terms

| Term | Means | Avoid | Not to be confused with |
|---|---|---|---|
| Invoice | A request for payment that we send to a customer | bill, tab | Receipt |
| Customer | A business that pays us for the product | client, account | User |
| User | A person who signs in to act for a customer | member | Customer |
```

## Rules

- **One term, one meaning.** A term is defined once. A word that means two things becomes two terms.
- **Name the words to avoid.** The Avoid column is the synonyms people actually reach for. It is what the checks look for.
- **A term is not also an avoid word,** and an avoid word belongs to one term only. The parser rejects both.
- **Use it everywhere.** Code identifiers, API paths, UI text, tests, docs, issues and conversation.
- **Short and brief.** A meaning is one sentence, up to 300 characters. Longer explanations are a wiki page the term links to.
- **Only a verified glossary is a rule.** A page with `Status: draft` is read as a note; set `Status: current` when the terms are right and checked by the people who know the domain.
- **Domain experts decide the words,** not the agents. When the language is unclear, ask (`/grill`).

## How development follows it

| Where | What happens |
|---|---|
| Workflow start | A current glossary is read into the workflow. An unusable one stops the run; a draft only adds a note; a missing one adds a note, or stops the run with `FACTORY_REQUIRE_LANGUAGE=1` |
| Product manager, analyzer, architect, backend, frontend, customer support, reviewer | Receive `language` (up to 40 terms, each with its meaning and avoid words) and use the terms exactly |
| Reviewer | Also receives `languageCheck.avoid_words_used`: every place the work uses an avoided word, to judge (wrong, or right in a quotation or a third-party name) |
| Interactive work | `/language` to build or revise the glossary; `/grill` to find the words |

## Changing it

A new or changed term is a PR with a reason, like any wiki change. Renaming a term in a live product is a migration: list what must change (code, copy, docs, data) in the plan's `assumed_changes`.
