# Lens: architecture and one-way doors (R3 changes only)

Judge the decision, not the syntax. Use the supplied architecture notes (ADRs, service README, contracts) as the standard; if none were supplied, say so in `needs_context`.

1. **Boundaries.** Does the change reach across a module or service boundary it should not (shared database tables, importing internals, hidden coupling, duplicated ownership)?
2. **Contracts.** Public APIs, events, schemas and CLI flags: is any change breaking for existing consumers? Is there a version, a deprecation path, a compatibility test? Name the consumers you can see.
3. **Data and migrations.** Locking behaviour on large tables, backfill strategy, ability to roll back, ordering relative to the code deploy, behaviour when old and new code run together during a rollout.
4. **Failure domains.** What happens to callers when this component is slow, down, or returns garbage? Timeouts, retries with backoff and jitter, idempotency keys, circuit breaking, queue depth limits.
5. **Reversibility.** Mark each decision as a two-way door (easy to undo) or a one-way door (data shape, public API, external contract, vendor lock-in). Every one-way door needs an explicit human decision: report it as a `blocker` with category `one_way_door` unless the PR description shows that decision was made.
6. **Operability.** Logging, metrics and alerts for the new behaviour; configuration defaults safe in production; feature can be switched off without a deploy (see the feature-settings skill).
7. **Consistency with stated architecture.** Contradictions with the ADRs or docs supplied.

Keep the output to the few decisions that matter. For each, state the cost of being wrong and the cheapest way to reduce it.
