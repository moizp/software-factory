# Styling Skill

Web front-ends use Tailwind CSS (v4, through `@tailwindcss/vite`) with the design tokens in `@theme`. The rule that matters most: **the CSS must not grow forever.** Utilities in the markup are bounded by the markup; hand-written CSS is bounded only by discipline, so it is capped and checked.

## Setup

- `npx sv add tailwindcss` (or the `@tailwindcss/vite` plugin by hand); `src/routes/layout.css` holds `@import 'tailwindcss';` and the tokens.
- Tokens come from `LOOKFEEL.md`: colours, type, radii, shadows, motion durations, as `@theme` variables (`--color-brand-600`, `--radius-card`). Invent none in components.
- Prettier sorts the classes (`prettier-plugin-tailwindcss`, `tailwindStylesheet` pointing at `layout.css`); never sort by hand. See `.claude/skills/developer-experience.md`.

## Rules that stop growth

1. **Utilities first.** Style in the markup. Hand-written CSS is `@theme` tokens, base styles, and the rare rule a utility cannot express.
2. **Reuse before adding.** Look for an existing utility, component or token. A repeated set of utilities becomes a Svelte component (one place to change), not a CSS class and not `@apply`.
3. **No values outside the tokens.** No raw hex colours, magic pixel sizes or new fonts in components; add the token to `@theme` once, with a reason, or use an existing one.
4. **Short `<style>` blocks.** At most 30 lines in a component, and delete CSS a change makes dead.
5. **Budgets.** `npm run css:check` (`scripts/css-budget.cjs`) fails on: hand-written CSS over `css_budget.authored_kb` (default 20 KB), a `<style>` block over `svelte_style_lines` (30), the same three or more declarations written twice, more than 10 `@apply`, and built CSS over `built_gzip_kb` (50 KB gzipped) once a build exists. It runs in `check:all`, in the pre-commit flow and in CI.
6. **A budget is not a target to raise.** Never raise a number to pass the check: restructure, or ask a person. A raise is a reviewed change to `project.config.json` with a reason.

## Room between things

Crowding is fixed with a Tailwind utility on the element (`gap-2`, `px-2`, `min-w-[12ch]`, `flex-wrap`, `shrink-0`), never a custom rule, and never by removing the focus ring. `npm run layout:guard` checks it on the real page; see `.claude/skills/layout-guard.md` and `templates/web-app/UI-RULES.md`.

## Reviewing a style change

- Did it reuse a component or utility, or add a rule? A new rule needs a sentence on why a utility could not do it.
- Is anything now unused (a class, a token, a `<style>` rule) that should go with this change?
- Does it follow `LOOKFEEL.md` (tokens, motion, `prefers-reduced-motion`)?

## Verified and not

The budget script and the Prettier plugin order were run on a real SvelteKit 3 and Tailwind 4 project: a long `<style>` block and a pair of duplicate rules fail, and unsorted classes are rewritten by `npm run fix`. Not measured: how large real apps get, so the default budgets are a starting point; tune them in the first weeks and record why.
