import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { DEFAULT_CORE, checkProject, checkSource, importsOf, parseBoundaries, renderReport } from '../boundaries';
import { DEFAULT_FRONTEND, loadStack, parseStack, renderStackLine, stackForAgents } from '../stack';
import { parsePlan, renderPlanSummary, stubPlan } from '../plan';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf-8');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));
const put = (dir: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const defaults = { core: DEFAULT_CORE, allow: [] as string[] };

describe('the stack agents are told', () => {
  it('defaults to SvelteKit, TypeScript, Tailwind and Svelte runes when the project declares no frontend', () => {
    const s = parseStack({ name: 'x', stack: 'ts-sveltekit-node', backend: { language: 'typescript', database: 'postgres' } });
    expect(s.frontend).toEqual(DEFAULT_FRONTEND);
    expect(s.frontendIsDefault).toBe(true);
    expect(DEFAULT_FRONTEND).toEqual({ framework: 'sveltekit', language: 'typescript', styling: 'tailwind', state_management: 'svelte-runes' });
    expect(s.database).toBe('postgres');
    expect(renderStackLine(s)).toContain('sveltekit');
    expect(renderStackLine(s)).toContain('the default');
  });
  it('lets a project declare another frontend, and keeps only short string values', () => {
    const s = parseStack({ frontend: { framework: 'react', language: 'typescript', styling: 'css-modules', 'bad key!': 'x', extra: 5, long: 'y'.repeat(200) } });
    expect(s.frontendIsDefault).toBe(false);
    expect(s.frontend.framework).toBe('react');
    expect(s.frontend['bad key!']).toBeUndefined();
    expect(s.frontend.extra).toBeUndefined();
    expect(s.frontend.long).toHaveLength(60);
    expect(stackForAgents(s)).toEqual({ frontend: s.frontend, backend: {} });
  });
  it('is the default for a missing or unreadable project.config.json, and read from the project directory', () => {
    const dir = tmp();
    expect(loadStack(dir).frontendIsDefault).toBe(true);
    put(dir, 'project.config.json', '{ not json');
    expect(loadStack(dir).frontendIsDefault).toBe(true);
    put(dir, 'project.config.json', JSON.stringify({ stack: 'ts-react-node', frontend: { framework: 'vue' } }));
    expect(loadStack(dir).frontend.framework).toBe('vue');
  });
  it('is what the sample project.config.json and the agent prompts say', () => {
    const cfg = JSON.parse(read('project.config.json'));
    expect(cfg.stack).toBe('ts-sveltekit-node');
    expect(cfg.frontend.framework).toBe('sveltekit');
    expect(read('.claude', 'agents', 'frontend-engineer.md')).toContain('**Svelte with SvelteKit**');
    expect(read('.claude', 'agents', 'analyzer.md')).toContain('`ts-sveltekit-node` (default)');
    for (const a of ['frontend-engineer', 'software-architect', 'analyzer', 'backend-engineer', 'automation-tester']) expect(read('.claude', 'agents', `${a}.md`)).toContain('`stack`');
  });
  it('leaves no React or TanStack default in the prompts that run, and names Tailwind as the styling', () => {
    for (const a of ['frontend-engineer', 'analyzer', 'software-architect', 'backend-engineer', 'ui-designer', 'automation-tester']) {
      const text = read('.claude', 'agents', `${a}.md`);
      expect(text).not.toMatch(/tanstack|React Testing Library|lucide-react|react-router|tailwind\.config|Next\.js/i);
    }
    expect(read('.claude', 'agents', 'frontend-engineer.md')).toContain('Tailwind CSS (`@tailwindcss/vite`)');
    expect(JSON.parse(read('project.config.json')).frontend.styling).toBe('tailwind');
    {
    }
    expect(read('.claude', 'agents', 'frontend-engineer.md')).not.toMatch(/Based on stack \(React/);
  });
});

describe('importsOf', () => {
  it('finds static, type, side-effect, re-export, require and dynamic imports, and ignores comments', () => {
    const src = [
      "import { a } from 'svelte';", "import type { B } from '$app/stores';", "import './side-effect';", "export { c } from '../c';", "export * from 'lodash';",
      "const d = require('express');", "const e = await import('react');", "// import x from 'vue';", "/* import y from 'next'; */",
      "const s = 'not an import';"
    ].join('\n');
    expect(importsOf(src).map(i => i.spec)).toEqual(['svelte', '$app/stores', './side-effect', '../c', 'lodash', 'express', 'react']);
    expect(importsOf(src)[1].line).toBe(2);
  });
});

describe('checkSource', () => {
  const check = (src: string, b = defaults) => checkSource('src/lib/core/x.ts', src, b);
  it('lets the core import other core files, and nothing else', () => {
    expect(check("import { a } from './a';\nimport { b } from '../b';\nimport { c } from '$lib/core/c';")).toEqual([]);
  });
  it('names a framework, an adapter and an outside package differently', () => {
    const v = check("import { onMount } from 'svelte';\nimport { page } from '$app/stores';\nimport Button from '$lib/components/Button.svelte';\nimport dayjs from 'dayjs';\nimport { readFile } from 'node:fs';");
    expect(v.map(x => x.kind)).toEqual(['framework', 'framework', 'adapter-import', 'external', 'external']);
    expect(v[0].message).toContain('adapter');
    expect(v[3].message).toContain('in-house');
  });
  it('counts a framework even behind a sub-path, but not a package that only starts with its name', () => {
    expect(check("import x from 'svelte/store';").map(v => v.kind)).toEqual(['framework']);
    expect(check("import x from '@sveltejs/kit';").map(v => v.kind)).toEqual(['framework']);
    expect(check("import x from 'svelte-fancy';").map(v => v.kind)).toEqual(['external']);
  });
  it('allows a package the project names, by package or by path', () => {
    expect(check("import { z } from 'zod';", { ...defaults, allow: ['zod'] })).toEqual([]);
    expect(check("import x from 'date-fns/format';", { ...defaults, allow: ['date-fns'] })).toEqual([]);
    expect(check("import x from 'react';", { ...defaults, allow: ['react'] }).map(v => v.kind)).toEqual(['framework']);
  });
});

describe('checkProject', () => {
  it('passes a project whose core is plain TypeScript and whose adapters import it', () => {
    const dir = tmp();
    put(dir, 'src/lib/core/money.ts', "export const cents = (n: number): number => Math.round(n * 100);\n");
    put(dir, 'src/lib/core/invoice.ts', "import { cents } from './money';\nexport const total = (xs: number[]) => cents(xs.reduce((a, b) => a + b, 0));\n");
    put(dir, 'src/routes/+page.svelte', '<script lang="ts">import { total } from "$lib/core/invoice";</script>\n');
    put(dir, 'src/lib/components/Button.ts', "import { onMount } from 'svelte';\n");
    const r = checkProject(dir, defaults);
    expect(r.files).toBe(2);
    expect(r.violations).toEqual([]);
    expect(renderReport(r)).toContain('no framework');
  });
  it('fails a core that imports a framework, an adapter or a package, or holds a component', () => {
    const dir = tmp();
    put(dir, 'src/lib/core/bad.ts', "import { goto } from '$app/navigation';\nimport _ from 'lodash';\nexport const x = 1;\n");
    put(dir, 'src/lib/core/Widget.svelte', '<p>hi</p>');
    put(dir, 'node_modules/svelte/index.ts', "import 'react';");
    const r = checkProject(dir, defaults);
    expect(r.violations.map(v => `${v.file}:${v.kind}`).sort()).toEqual(['src/lib/core/Widget.svelte:adapter-file', 'src/lib/core/bad.ts:external', 'src/lib/core/bad.ts:framework']);
    expect(renderReport(r)).toContain('src/lib/core/bad.ts:1');
  });
  it('reads the core globs from the configuration', () => {
    const dir = tmp();
    put(dir, 'packages/shared/core/a.ts', "import x from 'express';");
    expect(checkProject(dir, defaults).files).toBe(0);
    const b = parseBoundaries({ core: ['packages/*/core/**'] });
    expect(b.ok && checkProject(dir, b.value).violations).toHaveLength(1);
  });
  it('validates the configuration', () => {
    expect(parseBoundaries(undefined)).toEqual({ ok: true, value: { core: DEFAULT_CORE, allow: [] } });
    expect(parseBoundaries({ core: 'src' }).ok).toBe(false);
    expect(parseBoundaries({ allow: [1] }).ok).toBe(false);
    expect(parseBoundaries([]).ok).toBe(false);
  });
});

describe('the plan says which modules are core and what it imports', () => {
  const plan = (extra: Record<string, unknown>, layer?: string) => ({ ...stubPlan(), modules: [{ ...stubPlan().modules[0], ...(layer ? { layer } : {}) }], ...extra });
  it('accepts layers and new dependencies, and shows them to the person approving', () => {
    const r = parsePlan(plan({ new_dependencies: [{ name: 'zod', why: 'Schema parsing that is easy to get subtly wrong', own_alternative: 'About 300 lines with weaker messages; not worth it' }] }, 'core'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = renderPlanSummary(r.plan);
      expect(text).toContain('Server (core)');
      expect(text).toContain('Layers: 1 core, 0 adapter');
      expect(text).toContain('New dependencies: zod');
      expect(text).toContain('in-house instead');
    }
  });
  it('says so when layers or dependencies are not stated, and when there are none', () => {
    const plain = parsePlan(stubPlan());
    expect(plain.ok && renderPlanSummary(plain.plan)).toContain('Layers: no module says whether it is core');
    expect(plain.ok && renderPlanSummary(plain.plan)).toContain('New dependencies: not stated');
    const none = parsePlan(plan({ new_dependencies: [] }, 'adapter'));
    expect(none.ok && renderPlanSummary(none.plan)).toContain('New dependencies: none');
  });
  it.each([
    [plan({}, 'shared'), 'layer'],
    [plan({ new_dependencies: 'zod' }), 'list'],
    [plan({ new_dependencies: [{ name: 'zod', why: 'short', own_alternative: 'short' }] }), 'new_dependencies[0]'],
    [plan({ new_dependencies: Array.from({ length: 11 }, (_, i) => ({ name: `p${i}`, why: 'a reason long enough', own_alternative: 'an alternative long enough' })) }), 'more than 10']
  ])('rejects a bad plan and says where', (raw, word) => {
    const r = parsePlan(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });
});

describe('the command', () => {
  it('exits 0 on a clean core, 1 on a violation, and 0 with a note when there is no core yet', () => {
    const bin = path.join(root, 'node_modules', '.bin', 'ts-node');
    const cli = path.join(root, '.factory', 'boundaries-cli.ts');
    const run = (dir: string) => spawnSync(bin, [cli], { cwd: dir, encoding: 'utf-8' });
    const none = run(tmp());
    expect(none.status).toBe(0);
    expect(none.stdout).toContain('nothing to check yet');
    const bad = tmp();
    put(bad, 'src/lib/core/a.ts', "import { x } from 'svelte';");
    const r = run(bad);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('src/lib/core/a.ts:1');
    const good = tmp();
    put(good, 'src/lib/core/a.ts', 'export const a = 1;');
    expect(run(good).status).toBe(0);
  });
});
