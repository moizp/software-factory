import * as fs from 'fs';
import * as path from 'path';

/**
 * Developer experience of a web app: formatting, class and import order, linting, one command that runs every check,
 * a local environment that explains itself. This reads the project's files and reports what is missing; the files
 * to start from are in templates/web-app/ and were tested on a real SvelteKit project.
 */

export interface DevExIssue {
  message: string;
  fix: string;
}

export interface DevExReport {
  /** False when the project is not a SvelteKit app, so there is nothing to check. */
  applicable: boolean;
  issues: DevExIssue[];
}

export const REQUIRED_SCRIPTS = ['dev', 'build', 'check', 'format', 'format:check', 'lint', 'test', 'check:all', 'css:check', 'compat:check', 'layout:guard', 'layout:prove', 'doctor'];
const TAILWIND = 'prettier-plugin-tailwindcss';
const SVELTE = 'prettier-plugin-svelte';

const exists = (root: string, rel: string): boolean => fs.existsSync(path.join(root, rel));
const readJson = (file: string): Record<string, any> | null => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; } };

function prettierPlugins(root: string): string[] | null {
  const rc = ['.prettierrc', '.prettierrc.json'].map(f => path.join(root, f)).find(f => fs.existsSync(f));
  const cfg = rc ? readJson(rc) : null;
  return cfg && Array.isArray(cfg.plugins) ? cfg.plugins.map(String) : null;
}

export function checkDevEx(root: string): DevExReport {
  const pkg = readJson(path.join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (!pkg || !deps['@sveltejs/kit']) return { applicable: false, issues: [] };

  const issues: DevExIssue[] = [];
  const add = (message: string, fix: string) => issues.push({ message, fix });
  const fromTemplate = 'copy it from templates/web-app/';

  const plugins = prettierPlugins(root);
  if (!plugins) add('no .prettierrc with a plugins list', `${fromTemplate}.prettierrc`);
  else {
    if (!plugins.includes(TAILWIND)) add('Prettier does not sort Tailwind classes', `add "${TAILWIND}" as the last plugin`);
    else if (plugins[plugins.length - 1] !== TAILWIND) add(`${TAILWIND} must be the last Prettier plugin, or class sorting does not run`, 'move it to the end of "plugins"');
    if (!plugins.includes(SVELTE)) add('Prettier does not format .svelte files', `add "${SVELTE}"`);
    if (!plugins.some(p => /sort-imports|organize-imports/.test(p))) add('Prettier does not sort imports', 'add "@ianvs/prettier-plugin-sort-imports" before the Svelte plugin');
  }
  for (const f of ['.prettierignore', '.editorconfig', 'scripts/doctor.sh', '.githooks/pre-commit', '.env.example']) {
    if (!exists(root, f)) add(`${f} is missing`, `${fromTemplate}${f}`);
  }
  if (!['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts'].some(f => exists(root, f))) add('no ESLint configuration', `${fromTemplate}eslint.config.js`);

  const scripts = pkg.scripts ?? {};
  const missing = REQUIRED_SCRIPTS.filter(s => !scripts[s]);
  if (missing.length) add(`package.json has no script for: ${missing.join(', ')}`, 'merge templates/web-app/package.additions.json into package.json');
  else if (!/format:check/.test(scripts['check:all'] ?? '') || !/lint/.test(scripts['check:all']) || !/test/.test(scripts['check:all'])) add('check:all does not run format:check, lint and test', 'make check:all run every check, as in templates/web-app/package.additions.json');

  const settings = readJson(path.join(root, '.vscode', 'settings.json'));
  if (!settings || settings['editor.formatOnSave'] !== true) add('the editor is not set to format on save', `${fromTemplate}.vscode/settings.json`);

  let ignore = '';
  try { ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8'); } catch { /* none */ }
  if (!/^\.env\s*$/m.test(ignore)) add('.env is not in .gitignore', 'add a line ".env" to .gitignore');
  return { applicable: true, issues };
}
