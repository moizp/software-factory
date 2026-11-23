import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Manifest, Shooter, captureEvidence, readManifest } from '../evidence/capture';
import { parsePreview, parseVisualChecks } from '../evidence/checks';
import { publishEvidence, slugOf } from '../evidence/publish';
import { pair, renderEvidence } from '../evidence/render';
import { checkVisualEvidence, uiFiles } from '../evidence/ui-paths';
import { lintPr } from '../gate/pr-lint';
import { parsePlan, renderPlanSummary, stubPlan } from '../plan';
import { STRICT_POLICY } from '../policy-engine';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-test-'));
const sh = (cwd: string, ...args: string[]) => { const r = spawnSync('git', args, { cwd, encoding: 'utf-8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** A shooter that writes distinct bytes per call, so hashes tell pictures apart. */
const fakeShooter = (variant: string): Shooter => ({
  async shoot(_url, check, width, file) { fs.writeFileSync(file, Buffer.concat([PNG, Buffer.from(`${variant}:${check.name}:${check.name === 'steady' ? '' : variant}:${width}`)])); },
  async close() {}
});
const noApp = async () => () => {};
const checks = [{ name: 'signup', path: '/signup', widths: [375, 1280] }, { name: 'steady', path: '/about', widths: [1280] }];
const preview = { command: 'true', url: 'http://localhost:3999', ready_path: '/', timeout_s: 5 };

describe('visual_checks and preview', () => {
  it('accepts a list of screens and fills the default widths', () => {
    const r = parseVisualChecks([{ name: 'signup-error', path: '/signup', state: 'wrong password' }]);
    expect(r).toEqual({ ok: true, value: [{ name: 'signup-error', path: '/signup', widths: [375, 1280], state: 'wrong password' }] });
    expect(parseVisualChecks(undefined)).toEqual({ ok: true, value: [] });
  });
  it.each([
    [[{ name: 'Bad Name', path: '/x' }], 'name'],
    [[{ name: 'a', path: 'x' }], 'path'],
    [[{ name: 'a', path: '/../etc' }], 'path'],
    [[{ name: 'a', path: '/x', widths: [500] }], 'widths'],
    [[{ name: 'a', path: '/x' }, { name: 'a', path: '/y' }], 'twice'],
    [Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, path: '/x' })), 'more than'],
    ['nope', 'list']
  ])('rejects %j and says why', (raw, word) => {
    const r = parseVisualChecks(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });
  it('parses the preview and only accepts a local address', () => {
    expect(parsePreview({ command: 'npm run dev', url: 'http://localhost:3000/' })).toEqual({ ok: true, value: { command: 'npm run dev', url: 'http://localhost:3000', ready_path: '/', timeout_s: 60 } });
    expect(parsePreview({ command: 'x', url: 'https://example.com' }).ok).toBe(false);
    expect(parsePreview({ url: 'http://localhost:3000' }).ok).toBe(false);
    expect(parsePreview(undefined).ok).toBe(false);
    expect(parsePreview({ command: 'x', url: 'http://localhost:1', timeout_s: 0 }).ok).toBe(false);
  });
});

describe('the plan carries the screens for a person to approve', () => {
  const plan = () => ({ ...stubPlan(), phases: [{ ...stubPlan().phases[0], visual_checks: [{ name: 'home', path: '/', widths: [375], state: 'empty list' }] }] });
  it('parses and shows them in the summary', () => {
    const r = parsePlan(plan());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.phases[0].visual_checks?.[0].name).toBe('home');
      expect(renderPlanSummary(r.plan)).toContain('Picture: / at 375 px (empty list), before and after');
    }
  });
  it('reports a bad screen with its place in the plan, and leaves plans without screens unchanged', () => {
    const bad = plan();
    (bad.phases[0].visual_checks![0] as any).path = 'home';
    const r = parsePlan(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('phases[0].visual_checks[0].path');
    const plain = parsePlan(stubPlan());
    expect(plain.ok && plain.plan.phases[0].visual_checks).toBeUndefined();
  });
});

describe('capture', () => {
  it('writes one picture per screen and width with a manifest of hashes', async () => {
    const out = tmp();
    const cwd = tmp();
    sh(cwd, 'init', '-q');
    const m = await captureEvidence({ cwd, preview, checks, label: 'before', outDir: out, shooter: fakeShooter('a'), start: noApp, now: () => new Date('2026-01-02T03:04:05Z') });
    expect(m.shots.map(s => `${s.check}-${s.width}`)).toEqual(['signup-375', 'signup-1280', 'steady-1280']);
    expect(fs.existsSync(path.join(out, 'before', 'signup-375.png'))).toBe(true);
    expect(readManifest(path.join(out, 'before'))).toEqual(m);
    expect(m.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(m.shots[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('refuses an empty list, and a shooter that writes nothing, and always stops the app', async () => {
    const cwd = tmp();
    await expect(captureEvidence({ cwd, preview, checks: [], label: 'after', outDir: tmp(), shooter: fakeShooter('a'), start: noApp })).rejects.toThrow('no visual_checks');
    let stopped = false;
    const lazy: Shooter = { async shoot() {}, async close() {} };
    await expect(captureEvidence({ cwd, preview, checks, label: 'after', outDir: tmp(), shooter: lazy, start: async () => () => { stopped = true; } })).rejects.toThrow('no picture was written');
    expect(stopped).toBe(true);
  });
  it('replaces the earlier pictures of the same label', async () => {
    const out = tmp();
    const cwd = tmp();
    await captureEvidence({ cwd, preview, checks, label: 'before', outDir: out, shooter: fakeShooter('a'), start: noApp });
    fs.writeFileSync(path.join(out, 'before', 'stale.png'), 'x');
    await captureEvidence({ cwd, preview, checks, label: 'before', outDir: out, shooter: fakeShooter('a'), start: noApp });
    expect(fs.existsSync(path.join(out, 'before', 'stale.png'))).toBe(false);
  });
});

describe('render', () => {
  const shot = (check: string, width: number, sha: string) => ({ check, width, file: `${check}-${width}.png`, sha256: sha });
  const man = (label: 'before' | 'after', commit: string, shots: ReturnType<typeof shot>[]): Manifest => ({ version: 1, label, commit, createdAt: 'x', shots });
  const before = man('before', 'aaaaaaa1111', [shot('signup', 375, '1'), shot('steady', 1280, '9'), shot('old', 375, '3')]);
  const after = man('after', 'bbbbbbb2222', [shot('signup', 375, '2'), shot('steady', 1280, '9'), shot('fresh', 375, '4')]);

  it('pairs by screen and width and names what changed', () => {
    const rows = pair(before, after);
    expect(rows.map(r => `${r.check}:${r.change}`).sort()).toEqual(['fresh:new', 'old:removed', 'signup:changed', 'steady:unchanged']);
  });
  it('renders a table with both pictures, the commits and the count of differences', () => {
    const md = renderEvidence(before, after, (label, file) => `https://x/${label}/${file}`);
    expect(md.startsWith('## Evidence')).toBe(true);
    expect(md).toContain('`aaaaaaa`');
    expect(md).toContain('`bbbbbbb`');
    expect(md).toContain('3 with a visible difference');
    expect(md).toContain('<img src="https://x/before/signup-375.png" alt="signup before" width="300">');
    expect(md).toContain('| fresh | 375 | none |');
  });
});

describe('the pull request gate', () => {
  const pictures = '## Evidence\n<img src="https://x/a.png" alt="a" width="300">';
  it('knows which files are the interface and leaves the factory\'s own files alone', () => {
    expect(uiFiles(['src/components/Button.tsx', 'src/app.css', 'index.html', 'src/api/users.ts', 'docs/page.html', '.factory/x.ts', 'src/Button.test.tsx', 'README.md', 'templates/a/index.html']))
      .toEqual(['src/components/Button.tsx', 'src/app.css', 'index.html']);
  });
  it('asks for pictures, an error from R2 up and a warning below', () => {
    expect(checkVisualEvidence('## Testing\nok', ['src/app.css'], 'R1')).toEqual([expect.objectContaining({ severity: 'warning', rule: 'visual-evidence-missing' })]);
    expect(checkVisualEvidence('## Testing\nok', ['src/app.css'], 'R2')[0].severity).toBe('error');
    expect(checkVisualEvidence('## Testing\nok', ['src/api.ts'], 'R3')).toEqual([]);
  });
  it('accepts pictures, or a stated reason, and nothing less', () => {
    expect(checkVisualEvidence(pictures, ['src/app.css'], 'R2')).toEqual([]);
    expect(checkVisualEvidence('## Screenshots\n![a](https://x/a.png)', ['src/app.css'], 'R2')).toEqual([]);
    expect(checkVisualEvidence('## Evidence\nNot applicable: the change only fixes a typo in a comment of the stylesheet', ['src/app.css'], 'R2')).toEqual([]);
    expect(checkVisualEvidence('## Evidence\nLooks fine', ['src/app.css'], 'R2')).toHaveLength(1);
    expect(checkVisualEvidence('## Evidence\nNot applicable: x', ['src/app.css'], 'R2')).toHaveLength(1);
  });
  it('is part of lintPr', () => {
    const body = '## What\nx\n\n## Testing\n- `npm test`: 10 pass';
    const files = ['src/a.css', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts'];
    const r = lintPr({ title: 'feat: x', body, commits: ['feat: x'], files, changedLines: 400, policy: STRICT_POLICY });
    expect(r.tier).toBe('R2');
    expect(r.errors.some(e => e.startsWith('visual-evidence-missing'))).toBe(true);
    const ok = lintPr({ title: 'feat: x', body: `${body}\n\n${pictures}`, commits: ['feat: x'], files, changedLines: 400, policy: STRICT_POLICY });
    expect(ok.errors.some(e => e.startsWith('visual-evidence-missing'))).toBe(false);
  });
});

describe('publish', () => {
  function remote(): string {
    const bare = tmp();
    sh(bare, 'init', '-q', '--bare');
    return bare;
  }
  function project(origin: string): string {
    const dir = tmp();
    sh(dir, 'init', '-q', '-b', 'main');
    sh(dir, 'remote', 'add', 'origin', origin);
    return dir;
  }
  async function pictures(cwd: string, variant: string): Promise<string> {
    const out = tmp();
    for (const label of ['before', 'after'] as const) await captureEvidence({ cwd, preview, checks, label, outDir: out, shooter: fakeShooter(`${variant}${label}`), start: noApp });
    return out;
  }
  const COMMIT = 'abcdef1234567890abcdef1234567890abcdef12';

  it('puts the pictures on an orphan evidence branch and leaves the working branch alone', async () => {
    const origin = remote();
    const cwd = project(origin);
    const out = await pictures(cwd, 'v1');
    const p = publishEvidence({ cwd, issue: 12, commit: COMMIT, outDir: out });
    expect(p.prefix).toBe('issue-12/abcdef1');
    expect(p.urlFor('after', 'signup-375.png')).toBe('issue-12/abcdef1/after/signup-375.png');
    expect(sh(origin, 'ls-tree', '-r', '--name-only', 'evidence')).toContain('issue-12/abcdef1/before/signup-375.png');
    expect(sh(origin, 'rev-parse', 'evidence')).toBe(p.commit);
    expect(sh(origin, 'branch', '--list')).not.toContain('main');
    expect(sh(origin, 'rev-list', '--max-parents=0', 'evidence').split('\n')).toHaveLength(1);
  });
  it('appends to what is there without rewriting it, and publishing the same pictures twice changes nothing', async () => {
    const origin = remote();
    const cwd = project(origin);
    const first = publishEvidence({ cwd, issue: 1, commit: COMMIT, outDir: await pictures(cwd, 'a') });
    const outB = await pictures(cwd, 'b');
    const second = publishEvidence({ cwd, issue: 2, commit: COMMIT, outDir: outB });
    expect(sh(origin, 'merge-base', '--is-ancestor', first.commit, second.commit)).toBe('');
    const files = sh(origin, 'ls-tree', '-r', '--name-only', 'evidence');
    expect(files).toContain('issue-1/abcdef1/after/manifest.json');
    expect(files).toContain('issue-2/abcdef1/after/manifest.json');
    const again = publishEvidence({ cwd, issue: 2, commit: COMMIT, outDir: outB });
    expect(again.commit).toBe(second.commit);
  });
  it('tries once more when the first push is turned away', async () => {
    const origin = remote();
    const marker = path.join(origin, 'rejected-once');
    fs.writeFileSync(path.join(origin, 'hooks', 'pre-receive'), `#!/bin/sh\nif [ ! -f "${marker}" ]; then touch "${marker}"; echo busy >&2; exit 1; fi\n`, { mode: 0o755 });
    const cwd = project(origin);
    const p = publishEvidence({ cwd, issue: 3, commit: COMMIT, outDir: await pictures(cwd, 'r') });
    expect(fs.existsSync(marker)).toBe(true);
    expect(sh(origin, 'rev-parse', 'evidence')).toBe(p.commit);
  });
  it('links GitHub pictures by commit so they never move, and never leaks a token from the remote', () => {
    expect(slugOf('https://x-access-token:ghs_abc@github.com/moizp/software-factory.git')).toBe('moizp/software-factory');
    expect(slugOf('git@github.com:moizp/software-factory.git')).toBe('moizp/software-factory');
    expect(slugOf('/tmp/some/bare')).toBeNull();
  });
  it('says what is missing', () => {
    const cwd = project(remote());
    expect(() => publishEvidence({ cwd, issue: 0, commit: COMMIT, outDir: tmp() })).toThrow('positive');
    expect(() => publishEvidence({ cwd, issue: 1, commit: 'nope', outDir: tmp() })).toThrow('commit id');
    expect(() => publishEvidence({ cwd, issue: 1, commit: COMMIT, outDir: tmp() })).toThrow('evidence:capture');
    const noRemote = tmp();
    sh(noRemote, 'init', '-q');
    const out = tmp();
    fs.mkdirSync(path.join(out, 'before')); fs.mkdirSync(path.join(out, 'after'));
    fs.writeFileSync(path.join(out, 'before', 'manifest.json'), '{}'); fs.writeFileSync(path.join(out, 'after', 'manifest.json'), '{}');
    expect(() => publishEvidence({ cwd: noRemote, issue: 1, commit: COMMIT, outDir: out })).toThrow('no remote');
  });
});

// The one test that drives a real browser. It runs where Playwright and a Chromium are installed (a project with its own
// end to end tests has both) and is skipped elsewhere; `npm run verify` reports which it was.
const playwrightHome = [process.env.FACTORY_PLAYWRIGHT_PATH, path.join(__dirname, '..', '..'), '/opt/node22/lib'].find(p => {
  try { if (!p) return false; require.resolve('playwright', { paths: [p] }); return true; } catch { return false; }
});
(playwrightHome ? describe : describe.skip)('with a real browser', () => {
  it('photographs a small app before and after a change, and the two pictures differ', async () => {
    process.env.FACTORY_PLAYWRIGHT_PATH = playwrightHome;
    const app = tmp();
    sh(app, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(app, 'theme.txt'), '#ffffff');
    fs.writeFileSync(path.join(app, 'server.js'), `
      const http = require('http'), fs = require('fs');
      http.createServer((req, res) => {
        const bg = fs.readFileSync(__dirname + '/theme.txt', 'utf8').trim();
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><body style="margin:0;background:' + bg + '"><h1 id="title" style="padding:40px;font-family:sans-serif">Hello ' + req.url + '</h1></body>');
      }).listen(39871);`);
    fs.writeFileSync(path.join(app, 'project.config.json'), JSON.stringify({ name: 'fixture', preview: { command: 'node server.js', url: 'http://localhost:39871', timeout_s: 20 } }));
    sh(app, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'chore: start');

    const out = tmp();
    const screens = [{ name: 'home', path: '/', widths: [375, 1280], wait_for: '#title' }];
    const opts = { cwd: app, preview: { command: 'node server.js', url: 'http://localhost:39871', ready_path: '/', timeout_s: 20 }, checks: screens, outDir: out };
    const before = await captureEvidence({ ...opts, label: 'before' });
    fs.writeFileSync(path.join(app, 'theme.txt'), '#ffe0e0');
    const after = await captureEvidence({ ...opts, label: 'after' });

    expect(fs.readFileSync(path.join(out, 'before', 'home-375.png')).subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(pair(before, after).map(r => r.change)).toEqual(['changed', 'changed']);
    // Same app, same screen: the same bytes, so a difference between two pictures is a difference in the app
    const again = await captureEvidence({ ...opts, label: 'after', outDir: tmp() });
    expect(again.shots.map(s => s.sha256)).toEqual(after.shots.map(s => s.sha256));
  }, 90_000);

  it('works end to end through the commands: capture before, change, capture after, publish, and a section to paste', () => {
    const app = tmp();
    sh(app, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(app, 'theme.txt'), '#ffffff');
    fs.writeFileSync(path.join(app, 'server.js'), `require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<body style="background:' + require('fs').readFileSync(__dirname + '/theme.txt', 'utf8') + '"><h1 id="t">Hi</h1>'); }).listen(39872);`);
    fs.writeFileSync(path.join(app, 'project.config.json'), JSON.stringify({ name: 'fixture', preview: { command: 'node server.js', url: 'http://localhost:39872', timeout_s: 20 } }));
    // The screens come from the approved plan: the command reads visual_checks out of the plan file
    fs.writeFileSync(path.join(app, 'visual-checks.json'), JSON.stringify({ ...stubPlan(), phases: [{ ...stubPlan().phases[0], visual_checks: [{ name: 'home', path: '/', widths: [375], wait_for: '#t' }] }] }));
    sh(app, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'chore: start');
    const bare = tmp();
    sh(bare, 'init', '-q', '--bare');
    sh(app, 'remote', 'add', 'origin', bare);
    const head = sh(app, 'rev-parse', 'HEAD');

    const cli = path.join(__dirname, '..', 'evidence-cli.ts');
    const bin = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'ts-node');
    const run = (...args: string[]) => spawnSync(bin, [cli, ...args], { cwd: app, encoding: 'utf-8', env: { ...process.env, FACTORY_PLAYWRIGHT_PATH: playwrightHome } });
    const a = run('capture', '--label', 'before');
    expect(a.stderr).toBe('');
    fs.writeFileSync(path.join(app, 'theme.txt'), '#ffe0e0');
    expect(run('capture', '--label', 'after').status).toBe(0);
    const p = run('publish', '--issue', '7', '--commit', head);
    expect(p.status).toBe(0);
    const md = fs.readFileSync(path.join(app, 'evidence', 'evidence.md'), 'utf-8');
    expect(md).toContain('| home | 375 |');
    expect(md).toContain('changed');
    expect(sh(bare, 'ls-tree', '-r', '--name-only', 'evidence')).toContain(`issue-7/${head.slice(0, 7)}/after/home-375.png`);

    const missing = run('capture', '--label', 'sideways');
    expect(missing.status).toBe(2);
  }, 120_000);
});
