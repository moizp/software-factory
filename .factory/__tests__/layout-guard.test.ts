import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..', '..');
const T = path.join(root, 'templates', 'web-app');
const GUARD = path.join(T, 'scripts', 'layout-guard.cjs');
const DEMO = path.join(T, 'demo', 'layout');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const guard = require(GUARD) as {
  LIMITS: { controlGap: number; labelGap: number; labelPadding: number; touch: number };
  evaluateRow(row: unknown, limits?: unknown): Array<{ rule: string; message: string; hint: string }>;
  evaluateFit(page: { scrollWidth: number; viewport: { w: number } }): Array<{ message: string }>;
  resolveConfig(raw?: Record<string, unknown>): { limits: Record<string, number>; widths: number[]; themes: string[]; textSizes: number[]; ignored: string[] };
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const compat = require(path.join(T, 'scripts', 'css-compat.cjs')) as {
  FEATURES: Array<{ id: string; caniuse: string; min: Record<string, number> }>;
  check(root: string, o?: { targets?: Record<string, number> }): { violations: Array<{ kind: string; message: string; file?: string }> };
};

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'layout-test-'));
const put = (dir: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

type Item = { name: string; kind: string; bordered: boolean; box: { x: number; y: number; w: number; h: number }; padL: number; padR: number; ring?: number; defaultWidth?: number; worstLen?: number };
const btn = (name: string, x: number, over: Partial<Item> = {}): Item => ({ name, kind: 'button', bordered: true, box: { x, y: 0, w: 44, h: 44 }, padL: 0, padR: 0, ring: 5, ...over });
const counter = (x: number, w: number, over: Partial<Item> = {}): Item => ({ name: '1 / 159', kind: 'counter', bordered: false, box: { x, y: 0, w, h: 44 }, padL: 8, padR: 8, ...over });
const row = (items: Item[], w = 1280) => ({ name: 'reader controls', items, viewport: { w } });
const messages = (r: ReturnType<typeof row>, limits?: unknown) => guard.evaluateRow(r, limits).map(v => v.message);

describe('layout guard: the checks on measured boxes', () => {
  it('names both elements and the gap when a counter sits 2 px from a button', () => {
    const m = messages(row([btn('Previous page', 0), counter(46, 60), btn('Next page', 108)]));
    expect(m).toContain('row "reader controls": "Previous page" (button) and "1 / 159" (counter) are 2 px apart, need at least 8 px');
  });
  it('accepts a counter 8 px from each button with its own padding', () => {
    expect(messages(row([btn('Previous page', 0), counter(52, 60), btn('Next page', 120)]))).toEqual([]);
  });
  it('requires 6 px between two controls, and reports the focus ring that would cover a neighbour', () => {
    const m = messages(row([btn('Previous page', 0), btn('Next page', 48)]));
    expect(m.some(x => /are 4 px apart, need at least 6 px/.test(x))).toBe(true);
    expect(m.some(x => /focus ring \(5 px\) of "Previous page" \(button\) covers "Next page" \(button\), 4 px away/.test(x))).toBe(true);
    expect(messages(row([btn('Previous page', 0), btn('Next page', 50)]))).toEqual([]);
  });
  it('reports overlap, a control outside the window, a small touch target, a missing ring and no padding', () => {
    expect(messages(row([btn('A', 0), btn('B', 30)])).some(x => /overlap by 14 px/.test(x))).toBe(true);
    expect(messages(row([btn('A', 290)], 320)).some(x => /outside the window \(left 290 px, right 334 px of 320 px\)/.test(x))).toBe(true);
    expect(messages(row([btn('A', 0, { box: { x: 0, y: 0, w: 32, h: 32 } })])).some(x => /32 x 32 px; touch targets need at least 44 px/.test(x))).toBe(true);
    expect(messages(row([btn('A', 0, { ring: 0 })])).some(x => /no visible focus ring/.test(x))).toBe(true);
    expect(messages(row([btn('P', 0), counter(52, 60, { padL: 0, padR: 0 }), btn('N', 120)])).some(x => /without its own horizontal padding/.test(x))).toBe(true);
  });
  it('reports a width that follows its content', () => {
    const grown = row([btn('P', 0), counter(52, 94, { defaultWidth: 50 }), btn('N', 154)]);
    expect(messages(grown).some(x => /grows from 50 px to 94 px when its content is longest; reserve a minimum width/.test(x))).toBe(true);
  });
  it('each message carries a Tailwind fix', () => {
    const hints = guard.evaluateRow(row([btn('P', 0), counter(46, 60, { padL: 0, padR: 0 }), btn('N', 108)])).map(v => v.hint);
    expect(hints.every(h => h && /[a-z]+-[\w[\]]+/.test(h))).toBe(true);
    const grown = guard.evaluateRow(row([btn('P', 0), counter(52, 94, { defaultWidth: 50, worstLen: 11 }), btn('N', 154)])).map(v => v.hint);
    expect(grown[0]).toMatch(/^min-w-\[12ch\]/);
  });
  it('a page that scrolls sideways fails the fit check', () => {
    expect(guard.evaluateFit({ scrollWidth: 360, viewport: { w: 320 } })[0].message).toMatch(/360 px wide in a 320 px window/);
    expect(guard.evaluateFit({ scrollWidth: 320, viewport: { w: 320 } })).toEqual([]);
  });
});

describe('layout guard: limits can only be tightened', () => {
  it('ignores a lower limit and says so; accepts a higher one', () => {
    const lower = guard.resolveConfig({ limits: { controlGap: 2, labelGap: 12 } });
    expect(lower.limits.controlGap).toBe(6);
    expect(lower.limits.labelGap).toBe(12);
    expect(lower.ignored.join(' ')).toMatch(/controlGap" = 2 is below the stated 6/);
  });
  it('keeps every width, theme and text size even when the config lists fewer', () => {
    const c = guard.resolveConfig({ widths: [1280], themes: ['dark'], textSizes: [100] });
    expect(c.widths).toEqual(expect.arrayContaining([320, 375, 390, 768, 1280]));
    expect(c.themes).toEqual(expect.arrayContaining(['light', 'dark']));
    expect(c.textSizes).toEqual([100, 150, 200]);
    expect(c.ignored.length).toBe(3);
  });
  it('adds widths, themes and sizes without removing any', () => {
    const c = guard.resolveConfig({ widths: [414], themes: ['sepia'], textSizes: [250] });
    expect(c.widths).toContain(414);
    expect(c.themes).toContain('sepia');
    expect(c.textSizes).toContain(250);
  });
  it('a limit that is not named is ignored', () => {
    expect(guard.resolveConfig({ limits: { foo: 9 } }).ignored[0]).toMatch(/"foo" is not one of/);
  });
});

describe('compatibility gate', () => {
  const project = (extra: Record<string, unknown>, files: Record<string, string>, pkg: Record<string, unknown> = {}) => {
    const d = tmp();
    put(d, 'project.config.json', JSON.stringify(extra));
    put(d, 'package.json', JSON.stringify(pkg));
    for (const [f, t] of Object.entries(files)) put(d, f, t);
    return d;
  };
  const kinds = (d: string) => compat.check(d).violations.map(v => v.kind);

  it('does not guess the targets: no browser_targets is a problem to ask the owner about', () => {
    expect(kinds(project({}, {}))).toEqual(['targets-missing']);
  });
  it('flags container queries for Safari 15 and names what is needed', () => {
    const d = project({ browser_targets: { safari: 15 } }, { 'src/a.svelte': '<div class="@container"><p class="@sm:flex"></p></div>' });
    const v = compat.check(d).violations;
    expect(v[0].kind).toBe('no-fallback');
    expect(v[0].message).toMatch(/container queries needs safari 16, the targets are safari 15|container queries needs safari 16; the targets are safari 15/);
  });
  it('accepts the same CSS when the target has it', () => {
    expect(kinds(project({ browser_targets: { safari: 16.4, chrome: 111, firefox: 128 } }, { 'src/a.svelte': '<div class="@container"></div>' }))).toEqual([]);
  });
  it('requires the declared fallback to stay in the file and a test that names the feature', () => {
    const decl = '/* compat-fallback: container-queries | flex-wrap: wrap | src/a.compat.test.ts */';
    const css = `${decl}\n.row { flex-wrap: wrap; }\n@container (min-width: 20rem) { .row { gap: 8px; } }\n`;
    const ok = project({ browser_targets: { safari: 15 } }, { 'src/a.css': css, 'src/a.compat.test.ts': "it('compat:container-queries keeps the wrap', () => {})" });
    expect(kinds(ok)).toEqual([]);
    const deleted = project({ browser_targets: { safari: 15 } }, { 'src/a.css': css.replace('.row { flex-wrap: wrap; }\n', ''), 'src/a.compat.test.ts': "it('compat:container-queries', () => {})" });
    expect(kinds(deleted)).toEqual(['fallback-missing']);
    const untested = project({ browser_targets: { safari: 15 } }, { 'src/a.css': css });
    expect(kinds(untested)).toEqual(['fallback-untested']);
  });
  it('Tailwind 4 with a Safari 15 target is stopped, with the way out', () => {
    const d = project({ browser_targets: { safari: 15, chrome: 100 } }, {}, { devDependencies: { tailwindcss: '^4.1.0' } });
    const v = compat.check(d).violations.find(x => x.kind === 'tailwind-version')!;
    expect(v.message).toMatch(/safari 16.4/);
    expect(v.message).toMatch(/Tailwind 3\.4/);
  });
  it('focus-visible is flagged for Safari 15.0 to 15.3 (a ring that would not show)', () => {
    const d = project({ browser_targets: { safari: 15 } }, { 'src/a.svelte': '<button class="focus-visible:ring-4"></button>' });
    expect(compat.check(d).violations[0].message).toMatch(/:focus-visible needs safari 15.4/);
  });
  it('its table of minimum versions matches caniuse-lite', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { feature, features } = require('caniuse-lite') as { feature: (p: unknown) => { stats: Record<string, Record<string, string>> }; features: Record<string, unknown> };
    const first = (stats: Record<string, string>) => Math.min(...Object.entries(stats).filter(([, v]) => v.startsWith('y')).map(([k]) => parseFloat(k)).filter(n => !Number.isNaN(n)));
    for (const f of compat.FEATURES) {
      const stats = feature(features[f.caniuse]).stats;
      expect({ id: f.id, chrome: f.min.chrome, safari: f.min.safari, firefox: f.min.firefox, ios: f.min.ios_saf })
        .toEqual({ id: f.id, chrome: first(stats.chrome), safari: first(stats.safari), firefox: first(stats.firefox), ios: first(stats.ios_saf) });
    }
  });
});

// The browser tests need Playwright with a Chromium; where it is missing they are skipped and the run says so.
const PW = process.env.FACTORY_PLAYWRIGHT_PATH ?? '';
const probe = spawnSync('node', ['-e', "const {chromium}=require(require.resolve('playwright',{paths:[process.env.P]}));chromium.launch().then(b=>b.close()).then(()=>process.exit(0),()=>process.exit(1))"], { env: { ...process.env, P: PW || root }, encoding: 'utf-8' });
const browser = probe.status === 0;
if (!browser) console.warn('layout guard browser tests skipped: Playwright with Chromium is not available (set FACTORY_PLAYWRIGHT_PATH to a folder that has it)');
const itBrowser = browser ? it : it.skip;

const run = (args: string[], cwd = root) => spawnSync('node', [GUARD, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, FACTORY_PLAYWRIGHT_PATH: PW || root } });

describe('layout guard in a real browser', () => {
  jest.setTimeout(120_000);

  itBrowser('passes the demo reader controls in every width, theme, text size and worst-case content', () => {
    const r = run(['--file', path.join(DEMO, 'reader-good.html')]);
    expect(r.stdout + r.stderr).toMatch(/layout guard: pass \(90 rows read in 90 combinations/);
    expect(r.status).toBe(0);
  });
  itBrowser('catches the deliberately crowded version, naming both elements and the gap', () => {
    const r = run(['--file', path.join(DEMO, 'reader-crowded.html')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/"Previous page" \(button\) and "page counter" \(counter\) are 2 px apart, need at least 8 px/);
    expect(r.stderr).toMatch(/focus ring \(5 px\) of "Previous page"/);
    expect(r.stderr).toMatch(/without its own horizontal padding/);
    expect(r.stderr).toMatch(/reserve a minimum width/);
    expect(r.stderr).toMatch(/fix with Tailwind: gap-2/);
  });
  itBrowser('catches a row that falls out of the window at 320 px and 200% text, and a removed focus ring', () => {
    const good = fs.readFileSync(path.join(DEMO, 'reader-good.html'), 'utf-8');
    const d = tmp();
    put(d, 'nowrap.html', good.replace('flex-wrap: wrap;', ''));
    const r = run(['--file', path.join(d, 'nowrap.html')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/outside the window/);
    put(d, 'noring.html', good.replace('box-shadow: 0 0 0 5px var(--ring);', ''));
    const r2 = run(['--file', path.join(d, 'noring.html')]);
    expect(r2.stderr).toMatch(/has no visible focus ring/);
  });
  itBrowser('fails when no row is marked, so it cannot pass by reading nothing', () => {
    const d = tmp();
    put(d, 'plain.html', '<!doctype html><body data-hydrated><button>x</button></body>');
    const r = run(['--file', path.join(d, 'plain.html')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no \[data-layout-row\] found/);
  });
  itBrowser('does not measure before the page is ready', () => {
    const d = tmp();
    put(d, 'late.html', '<!doctype html><body><div data-layout-row="r"></div></body>');
    put(d, 'layout-guard.config.json', '{"timeoutMs": 1500}');
    const r2 = spawnSync('node', [GUARD, '--file', path.join(d, 'late.html')], { cwd: d, encoding: 'utf-8', env: { ...process.env, FACTORY_PLAYWRIGHT_PATH: PW || root } });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/never became ready/);
  });

  describe('prove: the guard must fail on the old code and pass on the fix', () => {
    const repo = (base: string, head: string) => {
      const d = tmp();
      const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: d, encoding: 'utf-8' });
      git('init', '-q', '-b', 'main');
      fs.copyFileSync(path.join(DEMO, base), path.join(d, 'page.html'));
      git('add', '.'); git('commit', '-q', '-m', 'base');
      fs.copyFileSync(path.join(DEMO, head), path.join(d, 'page.html'));
      return d;
    };
    itBrowser('proves a real fix: FAIL on the base, PASS on the head', () => {
      const d = repo('reader-crowded.html', 'reader-good.html');
      const r = run(['prove', '--base', 'HEAD', '--file', 'page.html'], d);
      expect(r.stdout).toMatch(/## Layout proof\nBase \(HEAD\): FAIL \(\d+ violations in 90 combinations\)\nHead: PASS \(0 violations in 90 combinations\)/);
      expect(r.stdout).toMatch(/Result: proven/);
      expect(r.status).toBe(0);
    });
    itBrowser('does not prove a change the guard already passed on the old code', () => {
      const d = repo('reader-good.html', 'reader-good.html');
      const r = run(['prove', '--base', 'HEAD', '--file', 'page.html'], d);
      expect(r.stdout).toMatch(/Result: NOT proven\. The guard passes on the old code/);
      expect(r.status).toBe(1);
    });
    itBrowser('does not prove a fix that still fails', () => {
      const d = repo('reader-crowded.html', 'reader-crowded.html');
      const r = run(['prove', '--base', 'HEAD', '--file', 'page.html'], d);
      expect(r.stdout).toMatch(/Head: FAIL/);
      expect(r.stdout).toMatch(/Result: NOT proven\. The guard still fails on the fix/);
      expect(r.status).toBe(1);
    });
    itBrowser('a config that lowers a limit does not make the crowded page pass', () => {
      const d = repo('reader-crowded.html', 'reader-crowded.html');
      put(d, 'layout-guard.config.json', JSON.stringify({ limits: { controlGap: 0, labelGap: 0, labelPadding: 0, touch: 0 }, widths: [1280] }));
      const r = run(['--file', 'page.html'], d);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/2 px apart, need at least 8 px/);
      expect(r.stderr).toMatch(/limits can only be tightened/);
    });
  });
});
