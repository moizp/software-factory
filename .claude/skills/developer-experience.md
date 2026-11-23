# Developer Experience Skill

Good developer experience is what keeps a codebase healthy while agents and people change it all day: fast feedback, one command that checks everything, tools that do the boring work, and a local setup that explains itself. `templates/web-app/` holds files that were tested on a real SvelteKit project; start from them and keep them current.

## Principles

1. **Automate what a tool can decide.** Formatting, Tailwind class order and import order are never argued in review and never done by hand: `npm run fix`.
2. **One command checks everything.** `npm run check:all` runs `format:check`, `lint`, `check` (svelte-check), `test` and `css:check`. CI runs the same command, so green locally means green in CI.
3. **Feedback is fast and local.** `npm run dev` hot-reloads; `npm run test:watch` and `check:watch` run on save; a pre-commit hook formats and lints what is committed.
4. **A failure says what to do.** Scripts and errors name the fix (`npm run doctor`, hook messages, error pages).
5. **No hidden setup.** Every environment variable is in `.env.example` with a safe local value; third parties are faked with `MOCK_EXTERNALS=1`; dependencies run with `docker compose`.
6. **Few tools, no hook package.** Hooks use `core.hooksPath` and plain shell, so there is nothing extra to install or break.

## What the template contains

| File | Does |
|---|---|
| `.prettierrc`, `.prettierignore` | Prettier with `@ianvs/prettier-plugin-sort-imports` (built-ins, packages, `$app`/`$env`, `$lib/core`, `$lib`, relative), then `prettier-plugin-svelte`, then `prettier-plugin-tailwindcss` last (it must be last) |
| `eslint.config.js` | typescript-eslint, eslint-plugin-svelte, Prettier compatibility, and the core rule: nothing in `src/lib/core` imports a framework or an outside package (tests excepted) |
| `.editorconfig` | Tabs in code, two spaces in JSON, YAML and Markdown, LF, final newline |
| `.vscode/` | Format on save, ESLint fix on save, recommended extensions, debug configs for the dev server and the current test |
| `.githooks/pre-commit` | Formats the staged files (classes and imports included), re-adds them, runs ESLint on them; skip once with `--no-verify` |
| `package.additions.json` | The scripts and the pinned dev dependencies to merge into `package.json` |
| `scripts/doctor.sh` | Checks Node version, packages, `.env`, ports, database and hooks; prints the fix for each |
| `scripts/css-budget.cjs` | The CSS growth check (`.claude/skills/styling.md`) |
| `.env.example`, `docker-compose.yml` | The environment and the database for local work |
| `src/lib/core/money.ts` and its test | A core module and a test, to show the layout and prove the setup |

Scripts: `dev`, `dev:host` (phone on the same network), `build`, `preview`, `check`, `format`, `format:check`, `lint`, `lint:fix`, `fix` (format and lint fix), `test`, `test:watch`, `css:check`, `check:all`, `clean`, `doctor`, `db:up`, `db:down`, `db:reset`.

## Local environment

The goal: clone to running app in five minutes, and a problem found without asking anyone.

1. `npm install` (the `prepare` script turns the hooks on), `cp .env.example .env`, `npm run db:up`, `npm run dev`.
2. `npm run doctor` when something is off. It names the fix for each failed check.
3. Structured logs (readable in development, JSON in production) with a request id on every line, a `/health` endpoint, seed data for local use, and error messages that say what to do.
4. The README has "Local development and troubleshooting": the five-minute start, the commands, and a table of the usual failures.

| Symptom | Usual cause | Fix |
|---|---|---|
| `EADDRINUSE` | A dev server is already running | Stop it, or change `PORT` in `.env` |
| Database connection refused | Compose is not up | `npm run db:up`; `npm run doctor` shows it |
| Odd build or type errors after a pull | Stale `.svelte-kit` or `node_modules` | `npm run clean && npm install` |
| Classes or imports reorder on commit | The hook is doing its job | Commit the result; `npm run fix` does the same on demand |
| Lint error "core imports ..." | A framework or package crept into `src/lib/core` | Move that code to an adapter, or write it in-house |
| `ERESOLVE` on install | A package needs another TypeScript | Keep `typescript` at `~6.0` until typescript-eslint supports 7 |

## Tested, and not

Run on a real `sv create` project (SvelteKit 3, Vite 8, Tailwind 4, Prettier 3, ESLint 9, Vitest 5): `check:all` passes, the hook blocks a commit with lint errors and formats the rest (classes and imports reordered), `doctor` reports a missing `.env` and an absent database with the fix, `build` succeeds. Not tested: Windows shells (the scripts are POSIX), the devcontainer idea, and a Postgres service actually started by `db:up`.
