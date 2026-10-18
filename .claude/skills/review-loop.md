# Review Loop Skill

How a writer responds to the AI review (Gate B) on its PR. Gate B produces `review-result.json`; this skill is the loop that consumes it. Pattern adapted from bounded review/fix loops: success is a fresh review of the current commit, every attempt is tied to a SHA, and a capped run reports the truth instead of claiming success.

## Contract

`review-result.json` carries (see `docs/HYBRID-PIPELINE.md` section 5):

| Field | Meaning |
|---|---|
| `head_sha` | Commit the review ran against |
| `attempt` | 1-based review attempt number for this PR |
| `verdict` | `approve`, `request_changes` or `block` |
| `tier` | `R0` to `R3` |
| `findings[]` | `severity`, `file`, `line`, `evidence_quote`, `explanation`, `suggested_fix`, `confidence` |
| `status` | `complete`, `degraded` (a lens failed) or `failed_closed` |

## Flow

```
push fixes
  ▼
wait for review (max 10 min) ──timeout──▶ STOP: report "timed out", add needs-human
  ▼
review-result.json.head_sha == PR head?
  ├─ no ─▶ stale: ignore the score, do not reuse it, wait for the new run
  ▼
status == complete?
  ├─ no ─▶ STOP: report "review degraded/failed", add needs-human
  ▼
verdict approve and no open blocker/major finding?
  ├─ yes ─▶ DONE: report, do not merge (the policy engine merges)
  ▼
for each finding: valid?
  ├─ valid ─▶ fix inside this task's scope
  ├─ false positive ─▶ reply on the thread with evidence, then resolve
  ├─ real but out of scope ─▶ note it for the PR body, do not widen the PR
  ▼
run the repo's checks ──red──▶ fix first, never push red
  ▼
commit only this task's files, push
  ▼
round += 1; round > 3, or same finding twice? ─▶ STOP: add needs-human
  └─ else back to the top
```

## Rules

- **Cap:** three fix rounds. Rounds that produce no edits count. Do not raise the cap yourself.
- **Same failure twice** escalates at once.
- **Read everything.** Read the whole review body and every page of unresolved threads. An empty inline list does not prove no work remains.
- **No score chasing.** Do not change correct code to satisfy a finding. A false positive gets a written reason and evidence quoted from the code, then it is resolved.
- **Older threads count.** An unresolved thread stays relevant after its lines move.
- **Resolve only what is fixed and pushed.** Use explicit file paths when staging.
- **Never merge, approve, or edit `.factory/policy.json`.** Merging belongs to the policy engine.
- **Never skip, disable or quarantine a test to get green.**

## Report (final message and PR comment)

PR URL, reviewed `head_sha`, rounds used, current verdict, checks run, findings fixed, findings rejected with reasons, findings left. State plainly whether the run ended in success, timeout, cap or degraded review. A capped or timed-out run is not complete.

## When the loop stops early

A capped, timed-out or degraded run (the `needs-human` cases above) ends with a handoff, so the person or session that takes over starts from facts: write it with `/handoff` (format in `.claude/skills/handoff.md`), listing the open findings by file and line, the rounds used, the checks last run and what was tried. Do not commit it to the PR unless asked; paste the Next steps into the PR comment instead.
