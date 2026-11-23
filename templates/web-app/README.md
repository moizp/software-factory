# Web app template

Files for a SvelteKit app with Tailwind: formatting, class and import sorting, linting, a pre-commit hook, a doctor script, a local environment, and a CSS growth check. Tested on a real project; see `.claude/skills/developer-experience.md` and `.claude/skills/styling.md`.

## Use

```bash
npx sv create my-app --template minimal --types ts --add tailwindcss="plugins:none"
cp -r .prettierrc .prettierignore .editorconfig eslint.config.js .mcp.json .github .vscode .githooks scripts .env.example docker-compose.yml my-app/
mkdir -p my-app/src/lib/core && cp src/lib/core/* my-app/src/lib/core/
cd my-app
# merge package.additions.json into package.json (scripts and devDependencies), then:
npm install            # also turns the git hooks on
cp .env.example .env
npm run doctor
npm run check:all
```

`.github/` holds CI (`check:all`), a weekly Dependabot configuration and a weekly dependency review; copy it with the rest. `.mcp.json` registers the official Svelte MCP (pinned), so Claude Code sessions in the app look Svelte APIs up in the current docs and run `svelte-autofixer`; see `.claude/skills/mcp-setup.md`. Add `.env` to `.gitignore`, and a `css_budget` object to `project.config.json` if the defaults (20 KB hand-written, 30-line `<style>` blocks, 50 KB built and gzipped) do not suit.

`npm run verify` in the factory checks a project against this template (`project.devex`, `project.css`). Keep `typescript` at `~6.0` until typescript-eslint supports TypeScript 7.
