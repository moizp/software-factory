# Lens: documentation synchronization (runs after merge, never blocks)

Compare the merged change against the documentation files supplied (README, API reference, OpenAPI, CHANGELOG, runbooks, config reference).

Report only places where the docs are now wrong or incomplete because of this change: renamed or removed flags and endpoints, changed defaults, new configuration, new failure modes, changed setup steps. For each, give the doc file and heading, the exact sentence that is now wrong (`evidence_quote` from the doc), and a replacement text of at most five lines.

Output suggested edits only. A separate step opens a documentation PR from them; this review never pushes to the repository.
