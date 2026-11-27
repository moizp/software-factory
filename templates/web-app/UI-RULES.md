# UI rules

Standing rules for every web interface built here. They come from real defects (controls and labels too close or overlapping, found by eye instead of by a check), not from taste. `npm run layout:guard` checks R1 to R8 on the running page; the agents are handed this file with every interface task. Prefer a Tailwind utility to a custom CSS rule: the fix for each rule is a class on the element.

## Rules

- R1: Keep at least 6 px between neighbouring controls, because a 5 px focus ring would touch the next one otherwise. (`gap-2` is 8 px.)
- R2: Keep at least 8 px between a label or counter and a bordered control. (`gap-2`.)
- R3: A counter or label between two bordered controls gets its own horizontal padding. (`px-2`.)
- R4: Anything whose width follows its content (digits, labels) gets a reserved minimum width. (`min-w-[12ch] tabular-nums text-center`: the longest content's characters plus one.)
- R5: The focus ring stays, and it must not cover a neighbour. Never remove it to make room; add space.
- R6: Touch targets are at least 44 px. (`size-11`, or `min-h-11 min-w-11`.)
- R7: Everything fits the window: no control outside it and no sideways scroll, at 320 px wide and 200% text. A row that cannot fit wraps or shrinks instead of widening the page. (`flex-wrap`, `min-w-0` on the flexible item, `shrink-0` on a control.)
- R8: Check worst-case content, not the default screenshot: 3 and 4 digit numbers, the longest label, large text, a narrow window, a visible focus ring, every colour theme.
- R9: Spacing and fit are tested together. A fix that adds space re-runs the fit checks (R7), because more space can push a control out of the window.
- R10: CSS that needs a newer browser than the project's `browser_targets` needs a fallback, and a test that fails if the fallback is deleted.
- R11: Prefer a Tailwind utility to a custom CSS rule.

## Checklist for every interface task

1. Put `data-layout-row="name"` on each row of controls, and `data-guard-worst="text"` on anything whose content varies (the longest it can be).
2. Run `npm run layout:guard` and the existing fit tests; both must pass. Never raise a limit, drop a width, theme or text size, skip a row, or add a retry or a fixed sleep to make them pass.
3. For a layout fix, run `npm run layout:prove -- --base origin/main`: the guard must fail on the old code and pass on the fix. Paste its result under "Layout proof" in the pull request.
4. Check `browser_targets` in `project.config.json` before using a newer CSS feature (`npm run compat:check`).
5. Commit as the identity `project.config.json` names (`git_identity`), keep scratch and log files out of the repository, never force-push, and never accept a hook that changes the author.
6. Verify claims (quotes, sizes, counts) against the primary source, not an agent's report. Run long test runs from a script file, and never `pkill -f` a pattern that appears in your own command line.
