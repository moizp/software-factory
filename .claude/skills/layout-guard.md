# Layout Guard Skill

Crowding and overlap are found by a check on the real page, not by eye. Rules in `templates/web-app/UI-RULES.md` (loaded as `ui_rules` by the frontend engineer, e2e tester and reviewer); guard in `templates/web-app/scripts/layout-guard.cjs`; prefer a Tailwind utility to a custom CSS rule.

## Why (the owner's evidence)

A book reader's control bar `[<] 5 / 105 [>]` had 2 px between the counter and the round buttons, and the 5 px keyboard focus ring covered the counter. It showed only with worst-case content (3 digit total, large text, narrow window, focus ring). The first fix (more padding and gaps) broke "everything fits the window" at large text in tiny windows, caught by a separate test. A tidy fix used container queries, which Safari 15 and a 320 px iPhone SE lack. What worked was an automated guard reading real element boxes, and counting a fix only when the guard FAILS on the old code and PASSES on the new (it failed 15 rows, such as `"Previous page (button)" and "1 / 159 (counter)" are 2 px apart, need at least 8 px`). These are the owner's account; the factory's own runs are under "Measured here".

## Rules (only what the owner stated)

| | Rule | Tailwind |
|---|---|---|
| R1 | at least 6 px between controls (a 5 px focus ring would touch) | `gap-2` |
| R2 | at least 8 px between a label or counter and a bordered control | `gap-2` |
| R3 | a counter or label between two bordered controls has its own horizontal padding | `px-2` |
| R4 | anything whose width follows its content has a reserved minimum width | `min-w-[12ch] tabular-nums text-center` |
| R5 | the focus ring stays and covers no neighbour | `focus-visible:ring-[5px]` plus room |
| R6 | touch targets at least 44 px | `size-11` |
| R7 | everything fits the window, at 320 px and 200% text | `flex-wrap`, `min-w-0`, `shrink-0` |
| R8 to R11 | test worst-case content; spacing and fit together; check browser targets; Tailwind first | |

## The guard

`npm run layout:guard` loads the real page (it starts `npm run preview`, or take `--url` or `--file`), waits for `body[data-hydrated]` and for fonts, reads each `[data-layout-row]` (its children's boxes, padding, and the ring each control shows when focused by keyboard) and fails naming both elements and the gap in px. Matrix: widths 320, 375, 390, 768, 1280; every theme (`light`, `dark` by `data-theme` and `prefers-color-scheme`); text 100, 150, 200 percent; default content and each variant in `data-guard-worst="999 / 999|9999 / 9999"`. It waits on state: no fixed sleeps, no retries.

- The page sets `document.body.dataset.hydrated = 'true'` in `onMount`. A page with no marked row fails.
- `layout-guard.config.json` (optional) may add `pages`, `widths`, `themes`, `textSizes`, `themeAttribute` and raise a limit. It can never lower a limit or drop a width, theme or text size: those are ignored and reported.

## Prove it

`npm run layout:prove -- --base origin/main` runs the guard on the base (a worktree, built) and on the fix. It exits 0 only when the base FAILS and the fix PASSES, and prints the "Layout proof" text for the pull request. The gate (`.factory/gate/layout.ts`) reads that text: a layout fix (a `fix/` branch, or layout words in the title, touching interface files) without a proof where `Base: FAIL` and `Head: PASS` is an error. No passing proof, no merge. The gate cannot re-run the guard (agents run without tools); the author runs it, and CI may repeat it.

## Compatibility

`npm run compat:check` (in `check:all`) reads `browser_targets` in `project.config.json` (`{"chrome": 100, "safari": 15, "firefox": 100, "ios_saf": 15}`; the owner sets them, nothing is assumed). It flags a feature the targets lack (container queries and units, `:has()`, `dvh`, `@layer`, `:focus-visible`, `text-balance`, subgrid, logical properties, `oklch()`, flex `gap`) and Tailwind 4 below Chrome 111, Safari 16.4 or Firefox 128 (Tailwind 3.4 is the way out). Allowed only with a fallback in the same file:

`/* compat-fallback: container-queries | flex-wrap: wrap | src/lib/Bar.compat.test.ts */`

The snippet must stay in the file and the test must exist and mention `compat:container-queries`; remove the fallback and `compat:check` fails. The minimums come from caniuse-lite, and a test compares the table with it.

## Reviewer and the gate

The reviewer reads the diff for R1 to R7, the guard result, the proof, and for any relaxing. The gate reads the diff for it, mechanically (`reviewLayoutDiff`): a lowered limit, a smaller matrix, `readySelector: false`, a skipped or focused test, a retry or fixed sleep in a test, fewer assertions, a row or worst-case mark removed, an outline turned off with no ring, a compat fallback removed. It also fails scratch and log files, a hook that sets the author, and (when `FACTORY_GIT_IDENTITY` or `git_identity` is set) a commit whose author or committer is not that identity.

## Checklist for every interface task

1. Mark rows (`data-layout-row`) and varying content (`data-guard-worst`).
2. `npm run layout:guard` and the fit tests pass; no limit, width, theme or size dropped.
3. A layout fix carries `npm run layout:prove` output.
4. Browser targets checked before a newer CSS feature.
5. Commit as the owner's identity; no scratch or log files; never force-push; no author-changing hook.
6. Verify claims (quotes, sizes, counts) against the primary source. Run long test runs from a script file, and never `pkill -f` a pattern in your own command line.

## Measured here

- Demo (`templates/web-app/demo/layout/`): the good row passes all 90 combinations; the crowded row fails with 15 distinct violations (gap 2 px, ring covers the counter, no padding, width follows digits) and the message above. Three runs each, same result.
- A real SvelteKit 3 + Tailwind 4 app made with `sv create`: crowded base `FAIL (23 violations in 90 combinations)`, Tailwind fix `PASS (0 ...)`, `Result: proven`. A first fix with `min-w-[10ch]` was caught as still failing (11 characters do not fit in 10): the guard found what eyes would not.
- `npm test` covers the checks on measured boxes, the config clamp, the compat table against caniuse-lite, the browser runs (skipped where Playwright and Chromium are missing), the proof, and every gate rule on diffs, including a real relaxing fix made in git.

## Not verified, and questions for the owner

- Only Chromium ran. Safari and Firefox (and the Safari 15 and iPhone SE cases) were not run: the browsers are not installed here.
- The ring is measured from computed `outline` and `box-shadow` after a keyboard focus, not from pixels.
- Not written down by the owner, so assumed or left to configure: the minimum for "own horizontal padding" (4 px each side here), the colour themes and how they switch (`light`/`dark`, `data-theme`), the browser targets (not guessed: `compat:check` fails until set), the git identity (nothing checked until set), and worst-case content (the guard cannot discover it; builders mark it).
- Tailwind 4's baseline (Chrome 111, Safari 16.4, Firefox 128) is from its documentation, not tested here. `aspect-ratio`, `color-mix()` and `@property` are not in the compat table (no verified data).
- The template CI step (`playwright install`, `layout:guard`) has not run on GitHub. The proof is checked as text, not re-run by the gate. A force-push cannot be seen in a diff: branch protection is the control. The hook check matches known patterns only.
