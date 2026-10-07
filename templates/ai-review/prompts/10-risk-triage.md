# Risk triage (cheap model; used only when the deterministic classifier is unsure)

Classify the change into exactly one tier using the facts below. Deterministic rules already ran; you only break ties.

- `R0`: docs, comments, tests-only, formatting. No runtime behaviour change.
- `R1`: small, local behaviour change inside one module; no new dependency; no change to data shape, auth, money, permissions, infrastructure, CI or public contracts.
- `R2`: multi-module change, new dependency, changed public function or API behaviour, new background job, changed configuration.
- `R3`: touches authentication or authorization, secrets, payments or money, data model or migrations, infrastructure or CI, cross-service contracts, concurrency or ordering guarantees, or is large (many files or lines).

When two tiers fit, choose the higher one. Return `{ "tier": "R0|R1|R2|R3", "reasons": ["..."] }` with at most three short reasons, each tied to a file or a fact from the input.
