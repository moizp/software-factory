import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_BUDGET, checkDependencies, parseBudget } from '../deps';
import { runChecks } from '../verify';
import { webAppChecks } from '../verify/checks/css';

const root = path.join(__dirname, '..', '..');
const T = path.join(root, 'templates', 'web-app');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf-8');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'deps-test-'));
const put = (dir: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pins = require(path.join(T, 'scripts', 'pins-check.cjs')) as {
  findPins(files: string[], read?: (f: string) => string): Array<{ file: string; server: string; pkg: string; pinned: string }>;
  check(files: string[], latest?: (p: string) => string | null, read?: (f: string) => string): { rows: Array<{ pkg: string; latest: string | null; behind: boolean }>; behind: unknown[]; unknown: unknown[] };
  newer(a: string, b: string): boolean;
};
const names = (n: number, p: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${p}${i}`, '^1.0.0']));

describe('the dependency count', () => {
  it('counts runtime and dev packages against the default or the configured budget', () => {
    const dir = tmp();
    put(dir, 'package.json', JSON.stringify({ dependencies: names(3, 'a'), devDependencies: names(5, 'd') }));
    expect(checkDependencies(dir)).toEqual({ applicable: true, runtime: 3, dev: 5, budget: DEFAULT_BUDGET, over: [] });
    put(dir, 'project.config.json', JSON.stringify({ dependency_budget: { runtime: 2, dev: 4 } }));
    expect(checkDependencies(dir).over).toEqual(['3 runtime packages, budget 2', '5 dev packages, budget 4']);
  });
  it('is not applicable without a package.json, and ignores a bad budget', () => {
    expect(checkDependencies(tmp()).applicable).toBe(false);
    expect(parseBudget({ runtime: -1, dev: 'x' })).toEqual(DEFAULT_BUDGET);
    expect(parseBudget(undefined)).toEqual(DEFAULT_BUDGET);
  });
  it('is within its own budget for the factory and for the web-app template', () => {
    expect(checkDependencies(root).over).toEqual([]);
    const add = JSON.parse(fs.readFileSync(path.join(T, 'package.additions.json'), 'utf-8'));
    // A new SvelteKit project has 11 dev packages; the template adds its own
    expect(11 + Object.keys(add.devDependencies).length).toBeLessThanOrEqual(DEFAULT_BUDGET.dev);
  });
  it('is the project.deps row: pass, then warn with how to fix it', async () => {
    const ctx = (projectDir: string) => ({ factoryRoot: root, projectDir, flags: { quick: true, live: false as const, github: false, createLabels: false, brief: 'b', tokenCap: 1 } });
    const row = async (dir: string) => (await runChecks(ctx(dir), webAppChecks.filter(c => c.id === 'project.deps')))[0];
    expect((await row(tmp())).status).toBe('skip');
    const dir = tmp();
    put(dir, 'package.json', JSON.stringify({ dependencies: names(2, 'a') }));
    expect((await row(dir)).status).toBe('pass');
    put(dir, 'package.json', JSON.stringify({ dependencies: names(20, 'a') }));
    const warned = await row(dir);
    expect(warned.status).toBe('warn');
    expect(warned.next).toContain('new_dependencies');
  });
});

describe('versions pinned outside package.json', () => {
  const files: Record<string, string> = {
    '.mcp.json': JSON.stringify({ mcpServers: { svelte: { type: 'stdio', command: 'npx', args: ['-y', '@sveltejs/mcp@0.1.31'] }, other: { command: 'node', args: ['server.js'] } } }),
    'project.config.json': JSON.stringify({ mcp_servers: { playwright: { args: ['@playwright/mcp@0.0.86', '--headless'] }, github: { type: 'built-in' } } }),
    'broken.json': '{ nope'
  };
  const reader = (f: string) => files[f];
  it('finds every pkg@x.y.z argument of an MCP server, in either file layout, and skips the rest', () => {
    expect(pins.findPins(Object.keys(files), reader).map(p => `${p.server}:${p.pkg}@${p.pinned}`)).toEqual(['svelte:@sveltejs/mcp@0.1.31', 'playwright:@playwright/mcp@0.0.86']);
  });
  it('says which pins are behind, and which it could not look up', () => {
    const latest = (p: string) => (p === '@sveltejs/mcp' ? '0.2.0' : p === '@playwright/mcp' ? '0.0.86' : null);
    const r = pins.check(Object.keys(files), latest, reader);
    expect(r.rows.map(x => [x.pkg, x.behind])).toEqual([['@sveltejs/mcp', true], ['@playwright/mcp', false]]);
    expect(r.behind).toHaveLength(1);
    expect(pins.check(Object.keys(files), () => null, reader).unknown).toHaveLength(2);
  });
  it('compares versions numerically', () => {
    expect(pins.newer('0.1.100', '0.1.31')).toBe(true);
    expect(pins.newer('1.0.0', '0.9.9')).toBe(true);
    expect(pins.newer('0.1.31', '0.1.31')).toBe(false);
    expect(pins.newer('0.1.9', '0.1.31')).toBe(false);
  });
  it('exits 1 behind and 0 current through the command, asking npm for the latest', () => {
    const dir = tmp();
    put(dir, '.mcp.json', files['.mcp.json']);
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const npm = (version: string) => fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
    const run = () => spawnSync('node', [path.join(T, 'scripts', 'pins-check.cjs'), '.mcp.json'], { cwd: dir, encoding: 'utf-8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    npm('0.9.0');
    const behind = run();
    expect(behind.status).toBe(1);
    expect(behind.stdout).toContain('behind');
    npm('0.1.31');
    expect(run().status).toBe(0);
  });
  it('is checked by the factory\'s own workflow against the pins it ships', () => {
    const wf = read('.github', 'workflows', 'dependency-review.yml');
    expect(wf).toContain('pins-check.cjs project.config.json templates/web-app/.mcp.json');
    expect(pins.findPins(['project.config.json', 'templates/web-app/.mcp.json'].map(f => path.join(root, f))).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the automatic updates', () => {
  const dependabot = (text: string) => ({
    ecosystems: [...text.matchAll(/package-ecosystem: ([\w-]+)/g)].map(m => m[1]),
    weekly: (text.match(/interval: weekly/g) ?? []).length,
    prefix: (text.match(/prefix: chore/g) ?? []).length
  });
  it('updates the factory\'s npm packages and actions weekly, grouped, as conventional chore commits', () => {
    const d = dependabot(read('.github', 'dependabot.yml'));
    expect(d).toEqual({ ecosystems: ['npm', 'github-actions'], weekly: 2, prefix: 2 });
    expect(read('.github', 'dependabot.yml')).toContain('update-types: [minor, patch]');
  });
  it('gives a web app the same, plus its compose images, CI that runs check:all, and a weekly review', () => {
    const d = dependabot(fs.readFileSync(path.join(T, '.github', 'dependabot.yml'), 'utf-8'));
    expect(d.ecosystems).toEqual(['npm', 'github-actions', 'docker-compose']);
    expect(d.weekly).toBe(3);
    expect(fs.readFileSync(path.join(T, '.github', 'workflows', 'ci.yml'), 'utf-8')).toContain('npm run check:all');
    const review = fs.readFileSync(path.join(T, '.github', 'workflows', 'dependency-review.yml'), 'utf-8');
    expect(review).toContain('cron:');
    expect(review).toContain('npm audit --omit=dev');
    expect(review).toContain('node scripts/pins-check.cjs');
  });
  it('keeps one issue open while something needs attention, and closes it when clear (both workflows)', () => {
    for (const wf of [read('.github', 'workflows', 'dependency-review.yml'), fs.readFileSync(path.join(T, '.github', 'workflows', 'dependency-review.yml'), 'utf-8')]) {
      expect(wf).toContain("'dependencies'");
      expect(wf).toContain("state: 'closed'");
      expect(wf).toContain('createComment');
      expect(wf).toMatch(/issues: write/);
      expect(wf).not.toMatch(/\$\{\{\s*github\.event\.(issue|pull_request)\.(title|body)/);
    }
  });
  it('is parseable YAML-ish: every workflow has on, permissions and jobs', () => {
    for (const f of ['ci.yml', 'dependency-review.yml']) {
      const t = fs.readFileSync(path.join(T, '.github', 'workflows', f), 'utf-8');
      for (const k of ['\non:', '\npermissions:', '\njobs:']) expect(t).toContain(k);
    }
  });
  it('is told to the agents and written down', () => {
    expect(read('.claude', 'agents', 'frontend-engineer.md')).toContain('keep updated, audited and patched');
    expect(read('.claude', 'agents', 'backend-engineer.md')).toContain('keep updated, audited and patched');
    expect(read('.claude', 'agents', 'software-architect.md')).toContain('one more to keep updated');
    expect(read('.claude', 'agents', 'infrastructure-engineer.md')).toContain('dependabot.yml');
    expect(read('.claude', 'skills', 'developer-experience.md')).toContain('Dependencies: fewer, and kept current');
    expect(JSON.parse(read('project.config.json')).dependency_budget).toEqual(DEFAULT_BUDGET);
  });
});
