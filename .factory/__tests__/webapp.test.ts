import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { REQUIRED_SCRIPTS, checkDevEx } from '../devex';
import { runChecks } from '../verify';
import { webAppChecks as allWebAppChecks } from '../verify/checks/css';

// The MCP and dependency rows have their own tests; these rows are the developer-experience and CSS ones
const webAppChecks = allWebAppChecks.filter(c => ['project.devex', 'project.css'].includes(c.id));

const root = path.join(__dirname, '..', '..');
const T = path.join(root, 'templates', 'web-app');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'webapp-test-'));
const put = (dir: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const json = (rel: string) => JSON.parse(fs.readFileSync(path.join(T, rel), 'utf-8'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const css = require(path.join(T, 'scripts', 'css-budget.cjs')) as { check(root: string, c?: Record<string, number>): { violations: Array<{ kind: string; message: string; file?: string }>; authoredBytes: number }; DEFAULTS: Record<string, number> };

/** A SvelteKit project as `sv create` makes it, with the template's files and scripts merged in. */
function project(): string {
  const dir = tmp();
  const copy = (from: string, to: string) => { fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true }); fs.copyFileSync(path.join(T, from), path.join(dir, to)); };
  for (const f of ['.prettierrc', '.prettierignore', '.editorconfig', 'eslint.config.js', '.vscode/settings.json', '.githooks/pre-commit', 'scripts/doctor.sh', '.env.example']) copy(f, f);
  const add = json('package.additions.json');
  put(dir, 'package.json', JSON.stringify({ name: 'app', scripts: add.scripts, devDependencies: { ...add.devDependencies, '@sveltejs/kit': '^3.2.0' } }));
  put(dir, '.gitignore', 'node_modules\n.env\n');
  return dir;
}

describe('the web-app template', () => {
  it('sorts imports, then formats Svelte, then sorts Tailwind classes last', () => {
    const rc = json('.prettierrc');
    expect(rc.plugins).toEqual(['@ianvs/prettier-plugin-sort-imports', 'prettier-plugin-svelte', 'prettier-plugin-tailwindcss']);
    const order: string[] = rc.importOrder;
    expect(order.indexOf('^\\$lib/core/(.*)$')).toBeLessThan(order.indexOf('^\\$lib/(.*)$'));
    expect(order[0]).toBe('<BUILTIN_MODULES>');
    expect(rc.tailwindStylesheet).toBe('./src/routes/layout.css');
  });
  it('has every script the check needs, and pins TypeScript below what typescript-eslint supports', () => {
    const add = json('package.additions.json');
    for (const s of REQUIRED_SCRIPTS) expect(add.scripts[s]).toBeTruthy();
    expect(add.scripts['check:all']).toMatch(/format:check.*lint.*check.*test.*css:check/);
    expect(add.devDependencies.typescript).toMatch(/^~6\.0/);
    for (const p of ['prettier', 'prettier-plugin-svelte', 'prettier-plugin-tailwindcss', '@ianvs/prettier-plugin-sort-imports', 'eslint', 'typescript-eslint', 'eslint-plugin-svelte', 'vitest']) expect(add.devDependencies[p]).toBeTruthy();
  });
  it('keeps the core free of frameworks and outside packages in ESLint, except in tests', () => {
    const cfg = fs.readFileSync(path.join(T, 'eslint.config.js'), 'utf-8');
    expect(cfg).toContain("files: ['src/lib/core/**']");
    expect(cfg).toContain("ignores: ['**/*.test.ts', '**/*.spec.ts']");
    expect(cfg).toContain('no-restricted-imports');
    const re = new RegExp(/regex: '([^']+)'/.exec(cfg)![1].replace(/\\\\/g, '\\'));
    for (const ok of ['./a', '../b', '$lib/core/x']) expect(re.test(ok)).toBe(false);
    for (const bad of ['svelte', '$app/stores', 'lodash', '$lib/components/Button.svelte']) expect(re.test(bad)).toBe(true);
  });
  it('ships a doctor that is valid bash, a hook that can run, and an env file where every variable has a value', () => {
    expect(spawnSync('bash', ['-n', path.join(T, 'scripts', 'doctor.sh')]).status).toBe(0);
    expect(fs.statSync(path.join(T, '.githooks', 'pre-commit')).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(path.join(T, '.githooks', 'pre-commit'), 'utf-8')).toMatch(/^#!\/bin\/sh/);
    const vars = fs.readFileSync(path.join(T, '.env.example'), 'utf-8').split('\n').filter(l => l && !l.startsWith('#'));
    expect(vars.length).toBeGreaterThan(3);
    for (const v of vars) expect(v).toMatch(/^[A-Z_]+=.+/);
    expect(fs.readFileSync(path.join(T, 'docker-compose.yml'), 'utf-8')).toContain('healthcheck');
  });
  it('runs doctor and fails with a fix for each missing thing in an empty project', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(T, 'scripts', 'doctor.sh'), path.join(dir, 'scripts', 'doctor.sh'));
    fs.copyFileSync(path.join(T, '.env.example'), path.join(dir, '.env.example'));
    const r = spawnSync('bash', [path.join(dir, 'scripts', 'doctor.sh')], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('fix: npm install');
    expect(r.stdout).toContain('fix: cp .env.example .env');
  });
});

describe('checkDevEx', () => {
  it('is not applicable to a project that is not a SvelteKit app', () => {
    expect(checkDevEx(tmp())).toEqual({ applicable: false, issues: [] });
    expect(checkDevEx(root).applicable).toBe(false);
  });
  it('finds nothing wrong with a project built from the template', () => {
    expect(checkDevEx(project())).toEqual({ applicable: true, issues: [] });
  });
  it('names each gap with its fix', () => {
    const dir = project();
    const rc = JSON.parse(fs.readFileSync(path.join(dir, '.prettierrc'), 'utf-8'));
    rc.plugins = ['prettier-plugin-tailwindcss', 'prettier-plugin-svelte'];
    put(dir, '.prettierrc', JSON.stringify(rc));
    fs.rmSync(path.join(dir, 'scripts', 'doctor.sh'));
    put(dir, '.vscode/settings.json', '{}');
    put(dir, '.gitignore', 'node_modules\n');
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    delete pkg.scripts['format:check'];
    put(dir, 'package.json', JSON.stringify(pkg));
    const messages = checkDevEx(dir).issues.map(i => i.message).join('\n');
    expect(messages).toContain('must be the last Prettier plugin');
    expect(messages).toContain('does not sort imports');
    expect(messages).toContain('scripts/doctor.sh is missing');
    expect(messages).toContain('format on save');
    expect(messages).toContain('.env is not in .gitignore');
    expect(messages).toContain('format:check');
    for (const i of checkDevEx(dir).issues) expect(i.fix.length).toBeGreaterThan(5);
  });
  it('says Prettier does not sort Tailwind classes when the plugin is absent', () => {
    const dir = project();
    put(dir, '.prettierrc', JSON.stringify({ plugins: ['prettier-plugin-svelte', '@ianvs/prettier-plugin-sort-imports'] }));
    expect(checkDevEx(dir).issues.map(i => i.message)).toContain('Prettier does not sort Tailwind classes');
  });
});

describe('the CSS budget', () => {
  const app = (files: Record<string, string>): string => { const d = tmp(); for (const [f, t] of Object.entries(files)) put(d, f, t); return d; };
  const kinds = (d: string, c?: Record<string, number>) => css.check(d, c).violations.map(v => v.kind);

  it('passes a project that styles with utilities and keeps its tokens in @theme', () => {
    const d = app({ 'src/routes/layout.css': "@import 'tailwindcss';\n@theme { --color-brand: #0a5; }\n", 'src/routes/+page.svelte': '<div class="p-4 text-white">hi</div>' });
    expect(css.check(d).violations).toEqual([]);
  });
  it('ignores comments, and counts only what people write (not node_modules or build output)', () => {
    const d = app({ 'src/a.css': '/* ' + 'x'.repeat(40000) + ' */\n.a { color: red }', 'node_modules/x/src/b.css': '.b { ' + 'color: red; '.repeat(5000) + '}' });
    expect(css.check(d).violations).toEqual([]);
  });
  it('fails when hand-written CSS passes its budget', () => {
    const d = app({ 'src/a.css': Array.from({ length: 400 }, (_, i) => `.c${i} { padding: ${i}px; margin: ${i + 1}px; }`).join('\n') });
    expect(kinds(d, { authored_kb: 5 })).toContain('authored-size');
    expect(kinds(d)).not.toContain('authored-size');
  });
  it('fails a long <style> block, repeated declarations, and heavy @apply', () => {
    const style = ['<div class="a b"></div>', '<style>', '.a { color: red; padding: 4px; margin: 2px; }', '.b { margin: 2px; color: red; padding: 4px; }', ...Array.from({ length: 30 }, (_, i) => `.r${i} { top: ${i}px; }`), '</style>'].join('\n');
    const d = app({ 'src/lib/Card.svelte': style });
    expect(kinds(d)).toEqual(expect.arrayContaining(['style-block', 'duplicate']));
    expect(kinds(app({ 'src/a.css': Array.from({ length: 11 }, (_, i) => `.x${i} { @apply p-${i}; }`).join('\n') }))).toContain('apply');
  });
  it('does not call two rules duplicates when they share fewer declarations than the minimum', () => {
    const d = app({ 'src/a.css': '.a { color: red; margin: 0 }\n.b { color: red; margin: 0 }' });
    expect(kinds(d)).toEqual([]);
  });
  it('checks the size of built CSS when a build exists', () => {
    const d = app({ 'src/a.css': '.a { color: red }' });
    const big = Array.from({ length: 300 }, (_, i) => `.u${i}{margin:${(i * 7919) % 1000}px ${(i * 104729) % 977}px;color:#${(i * 2654435761 % 16777216).toString(16).padStart(6, '0')}}`).join('\n');
    put(d, '.svelte-kit/output/client/_app/immutable/assets/app.css', big);
    expect(kinds(d, { built_gzip_kb: 1 })).toContain('built-size');
    expect(kinds(d)).not.toContain('built-size');
  });
  it('is what the command says, with the budget read from project.config.json', () => {
    const d = app({ 'src/a.css': Array.from({ length: 300 }, (_, i) => `.c${i} { padding: ${i}px; margin: ${i + 1}px; }`).join('\n'), 'project.config.json': JSON.stringify({ css_budget: { authored_kb: 1 } }) });
    const r = spawnSync('node', [path.join(T, 'scripts', 'css-budget.cjs'), '--root', d], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('budget 1 KB');
    const ok = spawnSync('node', [path.join(T, 'scripts', 'css-budget.cjs'), '--root', app({ 'src/a.css': '.a { color: red }' })], { encoding: 'utf-8' });
    expect(ok.status).toBe(0);
  });
});

describe('the verify rows for a web app', () => {
  const ctx = (projectDir: string) => ({ factoryRoot: root, projectDir, flags: { quick: true, live: false as const, github: false, createLabels: false, brief: 'b', tokenCap: 1 } });
  it('skip for the factory itself (no web app, no src), pass for a project from the template, and fail with the gaps', async () => {
    const [d0, c0] = await runChecks(ctx(root), webAppChecks);
    expect([d0.status, c0.status]).toEqual(['skip', 'skip']);
    const dir = project();
    put(dir, 'src/routes/layout.css', "@import 'tailwindcss';");
    expect((await runChecks(ctx(dir), webAppChecks)).map(r => r.status)).toEqual(['pass', 'pass']);
    fs.rmSync(path.join(dir, '.editorconfig'));
    put(dir, 'src/a.css', Array.from({ length: 30000 }, (_, i) => `.c${i}{padding:${i}px;margin:${i}px}`).join('\n'));
    const rows = await runChecks(ctx(dir), webAppChecks);
    expect(rows.map(r => r.status)).toEqual(['fail', 'fail']);
    expect(rows[0].extra).toContain('.editorconfig is missing');
    expect(rows[1].next).toContain('never raise a budget');
  });
});

describe('the project.layout verify row', () => {
  const layoutRow = allWebAppChecks.filter(c => c.id === 'project.layout');
  const ctx = (projectDir: string) => ({ factoryRoot: root, projectDir, flags: { quick: true, live: false as const, github: false, createLabels: false, brief: 'b', tokenCap: 1 } });
  const withScripts = (): string => {
    const dir = project();
    put(dir, 'src/routes/+page.svelte', '<div data-layout-row="reader"></div>');
    for (const f of ['layout-guard.cjs', 'css-compat.cjs']) fs.copyFileSync(path.join(T, 'scripts', f), (fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true }), path.join(dir, 'scripts', f)));
    return dir;
  };
  it('skips the factory itself, fails without the scripts, and warns about what only the owner can answer', async () => {
    expect((await runChecks(ctx(root), layoutRow))[0].status).toBe('skip');
    const bare = project();
    put(bare, 'src/a.svelte', '<p></p>');
    expect((await runChecks(ctx(bare), layoutRow))[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('layout-guard.cjs') });
    const dir = withScripts();
    const [row] = await runChecks(ctx(dir), layoutRow);
    expect(row.status).toBe('warn');
    expect(row.extra).toContain('browser_targets is not set');
    expect(row.extra).toContain('git_identity is not set');
    expect(row.detail).toMatch(/11 UI rules \(factory\), 1 row\(s\) marked/);
  });
  it('passes once the owner has answered, and says when a config tries to lower a limit', async () => {
    const dir = withScripts();
    put(dir, 'project.config.json', JSON.stringify({ browser_targets: { safari: 16.4 }, git_identity: { name: 'Owner', email: 'o@example.com' } }));
    expect((await runChecks(ctx(dir), layoutRow))[0].status).toBe('pass');
    put(dir, 'layout-guard.config.json', JSON.stringify({ limits: { touch: 30 } }));
    const [row] = await runChecks(ctx(dir), layoutRow);
    expect(row.status).toBe('warn');
    expect(row.extra).toContain('limits can only be tightened');
  });
  it('fails when the project UI-RULES.md cannot be read, and warns when no row is marked', async () => {
    const dir = withScripts();
    put(dir, 'project.config.json', JSON.stringify({ browser_targets: { safari: 16.4 }, git_identity: { name: 'O', email: 'o@example.com' } }));
    put(dir, 'UI-RULES.md', '# nothing useful');
    expect((await runChecks(ctx(dir), layoutRow))[0].status).toBe('fail');
    fs.rmSync(path.join(dir, 'UI-RULES.md'));
    fs.writeFileSync(path.join(dir, 'src', 'routes', '+page.svelte'), '<p></p>');
    expect((await runChecks(ctx(dir), layoutRow))[0].extra).toContain('no row of controls is marked');
  });
});
