# Record decisions in the wiki

Status: current
Last verified: 2026-10-19
Sources: the software factory's wiki guide (.claude/skills/wiki.md)

We write down each decision that is costly to reverse, in a short numbered record, so nobody has to rediscover why.

## Context

People and agents join a project with the code and nothing of the reasoning. The same questions get asked again, and a good decision is undone because its reason was lost.

## Decision

Each decision that is costly to reverse gets a page `decisions/NNNN-short-title.md` with Context, Decision and Consequences. A decision that is replaced stays, marked deprecated, with a link to the one that replaces it.

## Consequences

The wiki grows by one small page per decision, linked from the [index](../README.md) and from the pages it affects. Reviewers can ask for a record when a pull request makes such a decision. Reading the decisions in order tells the story of the project.
