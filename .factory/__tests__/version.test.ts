import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runChecks } from '../verify';
import { versionChecks } from '../verify/checks/version';

const root = path.join(__dirname, '..', '..');
const SCRIPT = path.join(root, 'templates', 'release', 'scripts', 'version.cjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const v = require(SCRIPT) as Record<string, (...a: any[]) => any>;

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'version-test-'));
const sh = (cwd: string, ...args: string[]) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf-8' }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), 'utf-8');

/** A repository with package.json and package-lock.json, one commit per subject given, and tags where asked. */
function repo(version = '1.0.0', commits: Array<string | { tag: string }> = []): string {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', version, scripts: {} }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'app', version, lockfileVersion: 3, packages: { '': { name: 'app', version } } }, null, 2) + '\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'chore: start');
  let n = 0;
  for (const c of commits) {
    if (typeof c === 'string') { fs.writeFileSync(path.join(dir, `f${n++}.txt`), c); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', c); }
    else sh(dir, 'tag', '-a', c.tag, '-m', c.tag);
  }
  return dir;
}

describe('reading a commit', () => {
  it('splits type, scope, text and breaking', () => {
    expect(v.parseCommit('feat(ui): add a button')).toEqual({ type: 'feat', scope: 'ui', breaking: false, text: 'add a button' });
    expect(v.parseCommit('fix!: drop the old route')).toMatchObject({ type: 'fix', breaking: true });
    expect(v.parseCommit('feat: x', 'details\n\nBREAKING CHANGE: the config moved')).toMatchObject({ breaking: true });
    expect(v.parseCommit('Added stuff')).toBeNull();
  });
});

describe('which bump the commits call for', () => {
  const c = (...subjects: string[]) => subjects.map((s, i) => ({ hash: `abcdef${i}0000`, subject: s, body: '' }));
  it('breaking is major, a feature is minor, a fix or perf is patch, and the rest is nothing', () => {
    expect(v.classify(c('fix: a', 'feat: b', 'feat!: c'), '1.2.3').bump).toBe('major');
    expect(v.classify(c('fix: a', 'feat: b'), '1.2.3').bump).toBe('minor');
    expect(v.classify(c('fix: a', 'docs: b'), '1.2.3').bump).toBe('patch');
    expect(v.classify(c('perf: a'), '1.2.3').bump).toBe('patch');
    expect(v.classify(c('docs: a', 'chore: b', 'test: c', 'ci: d', 'refactor: e', 'style: f', 'build: g'), '1.2.3').bump).toBe('none');
  });
  it('is one step lower before 1.0.0', () => {
    expect(v.classify(c('feat!: a'), '0.4.0').bump).toBe('minor');
    expect(v.classify(c('feat: a'), '0.4.0').bump).toBe('patch');
  });
  it('lists what it could not read, and still counts the rest', () => {
    const r = v.classify(c('Merged something', 'fix: a'), '1.0.0');
    expect(r.unknown).toHaveLength(1);
    expect(r.bump).toBe('patch');
  });
  it('raises the version', () => {
    expect([v.increase('1.2.3', 'major'), v.increase('1.2.3', 'minor'), v.increase('1.2.3', 'patch')]).toEqual(['2.0.0', '1.3.0', '1.2.4']);
  });
});

describe('next, from git', () => {
  it('is the project\'s own version for the first release, listing what was done', () => {
    const dir = repo('1.0.0', ['feat: add search', 'fix: stop a crash']);
    const p = v.next(dir);
    expect(p).toMatchObject({ first: true, lastTag: null, next: '1.0.0' });
    expect(p.groups.feat.map((x: any) => x.text)).toEqual(['add search']);
  });
  it('counts only commits after the last tag, and ignores merge commits', () => {
    const dir = repo('1.0.0', ['feat: old feature', { tag: 'v1.0.0' }, 'fix: new fix']);
    sh(dir, 'checkout', '-q', '-b', 'topic');
    fs.writeFileSync(path.join(dir, 'topic.txt'), 'x');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', 'feat: topic feature');
    sh(dir, 'checkout', '-q', 'main');
    sh(dir, 'merge', '-q', '--no-ff', 'topic', '-m', 'Merge pull request #1 from x/topic');
    const p = v.next(dir);
    expect(p).toMatchObject({ lastTag: 'v1.0.0', bump: 'minor', next: '1.1.0' });
    expect(p.groups.feat.map((x: any) => x.text)).toEqual(['topic feature']);
    expect(p.groups.fix.map((x: any) => x.text)).toEqual(['new fix']);
    expect(p.unknown).toEqual([]);
  });
  it('takes the newest tag by version, not by name or date', () => {
    const dir = repo('1.0.0', [{ tag: 'v1.9.0' }, { tag: 'v1.10.0' }, { tag: 'v1.2.0' }, { tag: 'not-a-release' }, 'fix: x']);
    expect(v.lastTag(dir)).toBe('v1.10.0');
    expect(v.next(dir).next).toBe('1.10.1');
  });
  it('says nothing is to be released after only docs and chores, and a base can be given', () => {
    const dir = repo('1.0.0', [{ tag: 'v1.0.0' }, 'docs: a', 'chore: b']);
    expect(v.next(dir)).toMatchObject({ bump: 'none', next: null });
    expect(v.next(dir, { since: 'v1.0.0' }).next).toBeNull();
    const cli = spawnSync('node', [SCRIPT, 'next'], { cwd: dir, encoding: 'utf-8' });
    expect(cli.status).toBe(3);
    expect(cli.stdout).toContain('nothing to release');
  });
});

describe('writing the version', () => {
  it('writes package.json and BOTH version fields of package-lock.json, keeping the formatting', () => {
    const dir = repo('1.0.0');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', scripts: { a: 'b' } }, null, '\t') + '\n');
    v.writeVersion(dir, '1.4.0');
    expect(JSON.parse(read(dir, 'package.json')).version).toBe('1.4.0');
    expect(read(dir, 'package.json')).toContain('\t"name"');
    const lock = JSON.parse(read(dir, 'package-lock.json'));
    expect([lock.version, lock.packages[''].version]).toEqual(['1.4.0', '1.4.0']);
    expect(lock.lockfileVersion).toBe(3);
    expect(read(dir, 'package-lock.json').endsWith('\n')).toBe(true);
  });
  it('works without a lock file, and refuses what is not a version', () => {
    const dir = repo('1.0.0');
    fs.rmSync(path.join(dir, 'package-lock.json'));
    expect(v.writeVersion(dir, '2.0.0')).toEqual(['package.json']);
    expect(() => v.writeVersion(dir, '2.0')).toThrow('not a version');
    expect(() => v.writeVersion(dir, '1.0.0-beta.1')).toThrow('not a version');
  });
});

describe('bump', () => {
  const dir0 = () => repo('1.0.0', ['feat: first thing', { tag: 'v1.0.0' }, 'feat(ui): add dark mode', 'fix: stop the crash', 'docs: tidy']);
  it('computes the next version, writes all three files, and the changelog lists what changed', () => {
    const dir = dir0();
    const r = v.bump(dir, { date: '2026-12-01' });
    expect(r.version).toBe('1.1.0');
    expect(r.files).toEqual(['package.json', 'package-lock.json', 'CHANGELOG.md']);
    const log = read(dir, 'CHANGELOG.md');
    expect(log).toContain('## [1.1.0] - 2026-12-01');
    expect(log).toContain('### Features\n- **ui:** add dark mode (');
    expect(log).toContain('### Fixes\n- stop the crash (');
    expect(log).not.toContain('tidy');
    expect(log.startsWith('# Changelog')).toBe(true);
    expect(v.check(dir, { version: '1.1.0' })).toEqual([]);
  });
  it('puts a new section above the older ones, and refuses to write the same version twice', () => {
    const dir = dir0();
    v.bump(dir, { date: '2026-12-01' });
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'chore: release v1.1.0'); sh(dir, 'tag', '-a', 'v1.1.0', '-m', 'x');
    fs.writeFileSync(path.join(dir, 'z.txt'), 'z'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'fix!: change the format');
    v.bump(dir, { date: '2026-12-08' });
    const log = read(dir, 'CHANGELOG.md');
    expect(log.indexOf('## [2.0.0]')).toBeLessThan(log.indexOf('## [1.1.0]'));
    expect(log).toContain('### Breaking changes');
    expect(() => v.bump(dir, { version: '2.0.0' })).toThrow('already has a section');
  });
  it('can be told the version, and says so when there is nothing to release', () => {
    const dir = repo('1.0.0', [{ tag: 'v1.0.0' }, 'chore: only a chore']);
    expect(() => v.bump(dir)).toThrow('nothing to release');
    expect(v.bump(dir, { version: '1.0.1', date: '2026-12-01' }).version).toBe('1.0.1');
    expect(read(dir, 'CHANGELOG.md')).toContain('Maintenance only.');
  });
  it('works through the command, and refuses a bad version', () => {
    const dir = dir0();
    const ok = spawnSync('node', [SCRIPT, 'bump', '--date', '2026-12-01'], { cwd: dir, encoding: 'utf-8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('version 1.1.0 written to package.json, package-lock.json, CHANGELOG.md');
    expect(spawnSync('node', [SCRIPT, 'bump', '--version', 'banana'], { cwd: dir, encoding: 'utf-8' }).status).toBe(2);
  });
});

describe('check and notes', () => {
  it('finds a lock file that disagrees with package.json, in either of its two fields', () => {
    const dir = repo('1.2.0');
    expect(v.check(dir)).toEqual([]);
    const lock = JSON.parse(read(dir, 'package-lock.json'));
    lock.version = '1.1.0';
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    expect(v.check(dir)[0]).toContain('package-lock.json says 1.1.0, package.json says 1.2.0');
    lock.version = '1.2.0'; lock.packages[''].version = '1.0.0';
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    expect(v.check(dir)[0]).toContain('packages[""]');
  });
  it('wants the release version and a changelog section to match what is being released', () => {
    const dir = repo('1.2.0');
    expect(v.check(dir, { version: '1.3.0' })).toEqual(['package.json says 1.2.0, the release is 1.3.0', 'CHANGELOG.md has no section for 1.3.0']);
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.0] - 2026-01-01\n\n### Fixes\n- a (abc1234)\n');
    expect(v.check(dir, { version: '1.2.0' })).toEqual([]);
    const cli = spawnSync('node', [SCRIPT, 'check', '--version', '1.9.9'], { cwd: dir, encoding: 'utf-8' });
    expect(cli.status).toBe(1);
  });
  it('prints one changelog section for the release notes', () => {
    const dir = repo('1.2.0');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.0] - 2026-02-01\n\n### Fixes\n- newer fix (abc1234)\n\n## [1.1.0] - 2026-01-01\n\n### Features\n- older feature (def5678)\n');
    expect(v.notes(dir, '1.2.0')).toBe('### Fixes\n- newer fix (abc1234)');
    expect(v.notes(dir, '1.1.0')).toBe('### Features\n- older feature (def5678)');
    expect(v.notes(dir, '9.9.9')).toBeNull();
  });
});

describe('the factory\'s own version', () => {
  const read2 = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf-8');
  it('is 1.0.0 in package.json, in the lock file (both fields) and in the changelog, and the sample config', () => {
    expect(JSON.parse(read2('package.json')).version).toBe('1.0.0');
    const lock = JSON.parse(read2('package-lock.json'));
    expect([lock.version, lock.packages[''].version]).toEqual(['1.0.0', '1.0.0']);
    expect(v.check(root, { version: '1.0.0' })).toEqual([]);
    expect(JSON.parse(read2('project.config.json')).factory_version).toBe('1.0.0');
    expect(v.notes(root, '1.0.0')).toContain('Known limits');
  });
  it('has scripts that run the shared script, and CI checks the files agree', () => {
    const scripts = JSON.parse(read2('package.json')).scripts;
    for (const k of ['next', 'bump', 'check']) expect(scripts[`version:${k}`]).toBe(`node templates/release/scripts/version.cjs ${k}`);
    expect(read2('.github', 'workflows', 'factory-test.yml')).toContain('npm run version:check');
  });
  it('is released by a workflow that checks the files, refuses a reused tag, and keeps the input out of script text', () => {
    const wf = read2('.github', 'workflows', 'factory-release.yml');
    expect(wf).toContain('workflow_dispatch');
    expect(wf).toContain('version.cjs check --version "$VERSION"');
    expect(wf).toContain('Tag v$VERSION already exists');
    expect(wf).toContain('gh release create');
    expect(wf).toContain('contents: write');
    expect(wf).not.toMatch(/run:[^\n]*\$\{\{\s*inputs/);
  });
});

describe('the release templates', () => {
  const read2 = (...p: string[]) => fs.readFileSync(path.join(root, 'templates', 'release', ...p), 'utf-8');
  it('Release Start works the version out when it is empty, then writes the files on the release branch', () => {
    const wf = read2('.github', 'workflows', 'release-start.yml');
    expect(wf).toContain("required: false");
    expect(wf).toContain('version.cjs next --json');
    expect(wf).toContain('version.cjs bump --version "$VERSION"');
    expect(wf).toContain('chore: release v$VERSION');
    expect(wf).toContain('package-lock.json');
    expect(wf.indexOf('Work out the version')).toBeLessThan(wf.indexOf('Validate version and one-RC-at-a-time'));
  });
  it('Release Finish checks the version files before it tags', () => {
    const wf = read2('.github', 'workflows', 'release-finish.yml');
    expect(wf.indexOf('version.cjs check --version "$VERSION"')).toBeGreaterThan(0);
    expect(wf.indexOf('version.cjs check')).toBeLessThan(wf.indexOf('git tag -a'));
  });
  it('is described where it is copied, in the skill, the infrastructure prompt and the adoption guide', () => {
    expect(read2('README.md')).toContain('scripts/version.cjs');
    expect(read2('..', '..', '.claude', 'skills', 'release-process.md')).toContain('## Versioning');
    expect(read2('..', '..', '.claude', 'agents', 'infrastructure-engineer.md')).toContain('version.cjs');
    expect(read2('..', '..', 'docs', 'ADOPTING.md')).toContain('factory_version');
  });
});

describe('the verify rows', () => {
  const ctx = (projectDir: string) => ({ factoryRoot: root, projectDir, flags: { quick: true, live: false as const, github: false, createLabels: false, brief: 'b', tokenCap: 1 } });
  const row = async (dir: string, id: string) => (await runChecks(ctx(dir), versionChecks.filter(c => c.id === id)))[0];

  it('project.version passes for agreeing files, fails with the fix for a stale lock file, and skips without a package.json', async () => {
    expect((await row(tmp(), 'project.version')).status).toBe('skip');
    const dir = repo('1.2.0', [{ tag: 'v1.2.0' }]);
    const ok = await row(dir, 'project.version');
    expect(ok.status).toBe('pass');
    expect(ok.detail).toContain('last release v1.2.0');
    const lock = JSON.parse(read(dir, 'package-lock.json'));
    lock.version = '1.1.0';
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
    const bad = await row(dir, 'project.version');
    expect(bad.status).toBe('fail');
    expect(bad.next).toContain('version.cjs bump');
  });
  it('project.factory skips the factory, warns without a recorded version or when behind, and passes when equal', async () => {
    expect((await row(root, 'project.factory')).status).toBe('skip');
    const dir = tmp();
    expect((await row(dir, 'project.factory')).status).toBe('warn');
    const cfg = (factory_version: unknown) => fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({ factory_version }));
    cfg('1.0.0');
    expect((await row(dir, 'project.factory')).status).toBe('pass');
    cfg('0.9.0');
    const behind = await row(dir, 'project.factory');
    expect(behind.status).toBe('warn');
    expect(behind.detail).toContain('major behind');
    expect(behind.next).toContain('CHANGELOG.md');
    cfg('2.0.0');
    expect((await row(dir, 'project.factory')).detail).toContain('newer');
    cfg('banana');
    expect((await row(dir, 'project.factory')).status).toBe('fail');
  });
});
