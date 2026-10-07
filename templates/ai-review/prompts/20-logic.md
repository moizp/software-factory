# Lens: logic flaws the author missed (tunnel-vision breaker)

The author has been deep in this change for hours and shares its assumptions. You do not. Work through these steps and report only what you can ground in the diff.

1. **Claims check.** List every claim in the PR description (what it does, what it does not touch, what was tested). For each, say `supported` or `unsupported` with the line that proves it. An unsupported claim is a finding.
2. **Assumptions.** For each changed function, list the 2-4 assumptions the author must have made (inputs non-empty, ordering, single caller, no concurrency, happy-path I/O, time zone, units). Check each against the code. A violated or unchecked assumption is a finding.
3. **Boundaries.** Empty, one, many; zero, negative, maximum; first and last iteration; null/undefined/NaN; unicode and very long strings; duplicate keys.
4. **Failure paths.** What happens when each call fails or times out half way? Partial writes, retries that duplicate effects, swallowed errors, cleanup that never runs, resources never released.
5. **State and ordering.** Shared mutable state, race windows, check-then-act, idempotency of anything that can be retried or delivered twice.
6. **Tests cannot fail.** Name three plausible mutations of the new logic (flip a condition, drop a branch, off by one). For each, state whether any added or existing test would fail. Tests that pass under all three are a `major` finding (`tests_gap`).
7. **Pre-mortem.** Assume this change caused a production incident next week. Write the two most likely one-line root causes, then check whether the diff contains the evidence for either.

Skip any step that does not apply to the change. Do not pad.
