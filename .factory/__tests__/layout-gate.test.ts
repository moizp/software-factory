import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkAuthorHooks, checkIdentity, checkLayoutProof, checkScratchFiles, isLayoutFix, parseIdentity, reviewLayoutDiff } from '../gate/layout';
import { lintPr } from '../gate/pr-lint';
import { loadPolicy } from '../policy-engine';

const root = path.join(__dirname, '..', '..');
const GUARD_SRC = path.join(root, 'templates', 'web-app', 'scripts', 'layout-guard.cjs');
const policy = loadPolicy('HEAD', root);

const FIX = ['src/lib/reader/Controls.svelte'];
const proof = (base: string, head: string) => `## Layout proof\nBase (origin/main): ${base}\nHead: ${head}\n`;

describe('layout proof gate', () => {
  it('recognises a layout fix by branch, words or files', () => {
    expect(isLayoutFix('fix/counter-crowding', 'fix: counter', FIX)).toBe(true);
    expect(isLayoutFix('feature/x', 'feat: tighten spacing in the reader', FIX)).toBe(true);
    expect(isLayoutFix('feature/x', 'feat: add search', FIX)).toBe(false);
    expect(isLayoutFix('fix/x', 'fix: parser', ['src/lib/core/parse.ts'])).toBe(false);
  });
  it('requires a proof that FAILS on the base and PASSES on the head', () => {
    const input = { branch: 'fix/counter', title: 'fix: counter', files: FIX, tier: 'R1' as const };
    expect(checkLayoutProof('', input)[0].message).toMatch(/no "Layout proof" section/);
    expect(checkLayoutProof(proof('PASS (0 violations in 90 combinations)', 'PASS (0 violations in 90 combinations)'), input)[0].message).toMatch(/does not show the guard FAILING on the base/);
    expect(checkLayoutProof(proof('FAIL (15 violations in 90 combinations)', 'FAIL (2 violations in 90 combinations)'), input)[0].message).toMatch(/does not show the guard PASSING on the head/);
    expect(checkLayoutProof(proof('FAIL (15 violations in 90 combinations)', 'PASS (0 violations in 90 combinations)'), input)).toEqual([]);
    expect(checkLayoutProof(proof('FAIL (15 violations in 90 combinations)', 'PASS (0 violations in 90 combinations)') + 'Result: NOT proven.', input)).toHaveLength(1);
  });
  it('accepts a stated reason, and ignores changes that are not layout fixes', () => {
    const input = { branch: 'fix/counter', title: 'fix: counter', files: FIX, tier: 'R1' as const };
    expect(checkLayoutProof('## Layout proof\nNot applicable: only a colour changes, no spacing', input)).toEqual([]);
    expect(checkLayoutProof('', { ...input, branch: 'feature/search', title: 'feat: search' })).toEqual([]);
  });
  it('is an error in the pull request check', () => {
    const r = lintPr({ title: 'fix: counter crowding', body: 'Fixes the counter.', commits: ['fix: counter crowding'], files: FIX, changedLines: 4, policy, branch: 'fix/counter-crowding' });
    expect(r.errors.some(e => e.startsWith('layout-proof-missing'))).toBe(true);
  });
});

describe('relaxation review (the gate side of "the reviewer rejects a fix that relaxes the limits")', () => {
  const diff = (file: string, removed: string[], added: string[]) =>
    [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@', ...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)].join('\n');
  const rules = (d: string) => reviewLayoutDiff(d).map(i => i.rule);

  it('rejects a lowered limit', () => {
    expect(rules(diff('scripts/layout-guard.cjs', ["const LIMITS = Object.freeze({ controlGap: 6, labelGap: 8, labelPadding: 4, touch: 44 });"], ["const LIMITS = Object.freeze({ controlGap: 6, labelGap: 2, labelPadding: 4, touch: 44 });"]))).toEqual(['limit-relaxed']);
    expect(rules(diff('layout-guard.config.json', ['  "limits": { "touch": 48 }'], ['  "limits": { "touch": 40 }']))).toEqual(['limit-relaxed']);
  });
  it('accepts a tightened limit', () => {
    expect(rules(diff('scripts/layout-guard.cjs', ['  controlGap: 6,'], ['  controlGap: 8,']))).toEqual([]);
  });
  it('rejects a smaller matrix and a guard that stops waiting for the page', () => {
    expect(rules(diff('scripts/layout-guard.cjs', ['widths: [320, 375, 390, 768, 1280],'], ['widths: [375, 1280],']))).toEqual(['matrix-shrunk']);
    expect(rules(diff('layout-guard.config.json', [], ['  "readySelector": false']))).toEqual(['guard-weakened']);
  });
  it('rejects skipped tests, blind retries and fixed sleeps', () => {
    expect(rules(diff('tests/reader.spec.ts', ["test('fits', async () => {"], ["test.skip('fits', async () => {"]))).toContain('test-skipped');
    expect(rules(diff('tests/reader.spec.ts', [], ['  await page.waitForTimeout(500);']))).toEqual(['blind-retry']);
    expect(rules(diff('playwright.config.ts', [], ['  retries: 3,']))).toEqual([]); // not a guard or test file: left to the reviewer's reading
    expect(rules(diff('tests/layout.test.ts', [], ['  retries: 3,']))).toEqual(['blind-retry']);
  });
  it('flags a skip or a sleep written as code, not one that is only quoted (as the tests of this gate do)', () => {
    expect(rules(diff('tests/a.spec.ts', [], ["  it.skip('x', () => {});"]))).toEqual(['test-skipped']);
    expect(rules(diff('tests/a.spec.ts', [], ["  expect(rules(diff('a', [], [\"test.skip('x')\"]))).toEqual([]);"]))).toEqual([]);
    expect(rules(diff('tests/a.test.ts', [], ["  const wait = new Promise(r => setTimeout(r, 500));"]))).toEqual(['blind-retry']);
  });
  it('rejects a weakened test, dropped rows and dropped worst-case marks', () => {
    expect(rules(diff('tests/reader.test.ts', ['  expect(a).toBe(1);', '  expect(b).toBe(2);'], ['  expect(a).toBe(1);']))).toEqual(['test-weakened']);
    expect(rules(diff('src/Reader.svelte', ['<div data-layout-row="reader" class="flex">'], ['<div class="flex">']))).toEqual(['row-skipped']);
    expect(rules(diff('src/Reader.svelte', ['<span data-guard-worst="9999 / 9999">'], ['<span>']))).toEqual(['worst-case-removed']);
  });
  it('rejects removing the focus ring to make room', () => {
    expect(rules(diff('src/Reader.svelte', ['<button class="focus-visible:ring-4">'], ['<button class="outline-none">']))).toEqual(['focus-ring-removed']);
    expect(rules(diff('src/Reader.svelte', [], ['<button class="outline-none focus-visible:ring-4">']))).toEqual([]);
  });
  it('rejects removing a compat fallback', () => {
    expect(rules(diff('src/a.css', ['/* compat-fallback: container-queries | flex-wrap | t.ts */'], []))).toEqual(['fallback-removed']);
  });
  it('catches a real relaxing fix made in git', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'));
    const git = (...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: d, encoding: 'utf-8' });
    git('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(d, 'scripts'));
    fs.copyFileSync(GUARD_SRC, path.join(d, 'scripts', 'layout-guard.cjs'));
    git('add', '.'); git('commit', '-q', '-m', 'base');
    const f = path.join(d, 'scripts', 'layout-guard.cjs');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace('touch: 44', 'touch: 30').replace('widths: [320, 375, 390, 768, 1280]', 'widths: [375, 1280]'));
    git('commit', '-qam', 'fix: make the guard pass');
    const out = git('diff', '--unified=0', 'HEAD~1..HEAD').stdout;
    expect(rules(out).sort()).toEqual(['limit-relaxed', 'matrix-shrunk']);
    const r = lintPr({ title: 'fix: counter', body: proof('FAIL (15 violations in 90 combinations)', 'PASS (0 violations in 90 combinations)'), commits: ['fix: counter'], files: ['scripts/layout-guard.cjs', 'src/Reader.svelte'], changedLines: 4, policy, branch: 'fix/counter', diff: out });
    expect(r.errors.some(e => e.startsWith('limit-relaxed'))).toBe(true);
  });
});

describe('orchestration lessons checked from the diff', () => {
  it('rejects a hook that changes the author', () => {
    const d = ['diff --git a/.githooks/pre-commit b/.githooks/pre-commit', '--- a/.githooks/pre-commit', '+++ b/.githooks/pre-commit', '@@ -1 +1 @@', '+git commit --amend --reset-author --no-edit'].join('\n');
    expect(checkAuthorHooks(d)[0].rule).toBe('hook-changes-author');
    const ok = d.replace('git commit --amend --reset-author --no-edit', 'npx prettier --check .');
    expect(checkAuthorHooks(ok)).toEqual([]);
  });
  it('checks author and committer against the identity the owner specified, and nothing when none is set', () => {
    const id = parseIdentity('Owner Name <owner@example.com>')!;
    const mine = { authorName: 'Owner Name', authorEmail: 'owner@example.com', committerName: 'Owner Name', committerEmail: 'owner@example.com', subject: 'fix: x' };
    expect(checkIdentity([mine], id)).toEqual([]);
    expect(checkIdentity([{ ...mine, committerEmail: 'noreply@anthropic.com' }], id)[0].message).toMatch(/committed by Owner Name <noreply@anthropic.com>/);
    expect(checkIdentity([{ ...mine, authorName: 'Bot' }], id)).toHaveLength(1);
    expect(checkIdentity([{ ...mine, authorName: 'Bot' }], null)).toEqual([]);
    expect(parseIdentity('nonsense')).toBeNull();
  });
  it('keeps scratch, log and output files out of the repository', () => {
    const files = ['src/a.svelte', 'run.log', 'tmp/out.json', 'nohup.out', 'test-results/x.png', 'layout-proof.json', 'src/a.svelte.orig', 'docs/guide.md'];
    expect(checkScratchFiles(files).map(i => i.message.split(' ')[0])).toEqual(['run.log', 'tmp/out.json', 'nohup.out', 'test-results/x.png', 'layout-proof.json', 'src/a.svelte.orig']);
  });
});
