import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  INDEX_END, INDEX_START, checkWiki, indexBlock, pageSourcePaths, parsePage, readWiki, renderIndex, scaffold, staleDays, updateIndex, wikiDir
} from '../wiki';

const root = path.join(__dirname, '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'wiki.md'), 'utf-8');
const exampleMd = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
const templateDir = path.join(root, 'templates', 'project', 'docs', 'wiki');
const NOW = new Date('2026-10-19T12:00:00Z');

const page = (over: { title?: string; status?: string; verified?: string; sources?: string; summary?: string; body?: string } = {}): string => [
  `# ${over.title ?? 'Payments retries'}`, '',
  ...(over.status === '' ? [] : [`Status: ${over.status ?? 'current'}`]),
  ...(over.verified === '' ? [] : [`Last verified: ${over.verified ?? '2026-10-01'}`]),
  ...(over.sources === '' ? [] : [`Sources: ${over.sources ?? 'src/payments/retry.ts; issue #88'}`]),
  '', over.summary ?? 'How a failed card payment is retried and when a person is told.', '',
  over.body ?? '## Rules\n\n- Three retries over 72 hours'
].join('\n');

const readme = (files: Record<string, string>): string => updateIndex(`# Project wiki\n\n${INDEX_START}\n${INDEX_END}\n`, files);
/** A wiki whose index is up to date. */
const wiki = (pages: Record<string, string>): Record<string, string> => ({ ...pages, 'README.md': readme(pages) });
const problems = (files: Record<string, string>, opts = {}) => checkWiki(files, { now: NOW, ...opts }).map(i => `${i.severity}:${i.path}:${i.message}`);
const has = (list: string[], text: string) => list.some(x => x.includes(text));

describe('parsePage', () => {
  it('reads title, metadata, sources, summary and links', () => {
    const p = parsePage('payments.md', page({ body: '## Rules\n\nSee [the code](../src/a.ts) and [site](https://x.dev) and `[not](a)`.' }));
    expect(p).toMatchObject({ title: 'Payments retries', status: 'current', verified: '2026-10-01', summary: 'How a failed card payment is retried and when a person is told.' });
    expect(p.sources).toEqual(['src/payments/retry.ts', 'issue #88']);
    expect(p.links).toEqual(['../src/a.ts', 'https://x.dev']);
  });
  it('lower-cases the status and ignores html comments', () => {
    expect(parsePage('a.md', `<!-- Status: draft -->\n${page({ status: 'Current' })}`).status).toBe('current');
  });
  it('picks out which sources are repository paths', () => {
    const p = parsePage('a.md', page({ sources: 'src/auth/; docs/api.md; issue #12; interview with Sam; https://x.dev/a; README.md' }));
    expect(pageSourcePaths(p)).toEqual(['src/auth/', 'docs/api.md', 'README.md']);
  });
});

describe('the index', () => {
  const pages = { 'a.md': page({ title: 'A | pipe', summary: 'A page about the pipe | character and the rest of what it covers.' }), 'b/c.md': page({ title: 'C', status: 'draft' }) };
  it('lists every page except the index, sorted, with status and summary', () => {
    const t = renderIndex({ ...pages, 'README.md': 'x' });
    expect(t.split('\n')).toHaveLength(4);
    expect(t).toContain('| [A \\| pipe](a.md) | current |');
    expect(t).toContain('| [C](b/c.md) | draft |');
  });
  it('clips a long summary', () => {
    const t = renderIndex({ 'a.md': page({ summary: 'x'.repeat(250) }) });
    expect(t).toContain('…');
  });
  it('is written between the markers and nowhere else', () => {
    const out = updateIndex(`intro\n${INDEX_START}\nold\n${INDEX_END}\noutro`, pages);
    expect(out.startsWith('intro')).toBe(true);
    expect(out.endsWith('outro')).toBe(true);
    expect(indexBlock(out)).toBe(renderIndex(pages));
    expect(() => updateIndex('no markers here', pages)).toThrow('needs <!-- wiki:index -->');
    expect(indexBlock('nothing')).toBeNull();
  });
});

describe('checkWiki', () => {
  it('passes a small wiki with an up-to-date index', () => {
    expect(problems(wiki({ 'payments.md': page() }))).toEqual([]);
  });
  it('needs an index with the markers, and says when it is out of date', () => {
    expect(has(problems({ 'a.md': page() }), 'there is no README.md')).toBe(true);
    expect(has(problems({ 'a.md': page(), 'README.md': '# Wiki' }), 'has no <!-- wiki:index -->')).toBe(true);
    const pages = { 'a.md': page() };
    const stale = { ...pages, 'README.md': readme({}) };
    expect(has(problems(stale), 'missing a.md')).toBe(true);
    const ghost = { ...pages, 'README.md': updateIndex(`${INDEX_START}\n| [Gone](gone.md) | current | x |\n${INDEX_END}`, { ...pages, 'gone.md': page({ title: 'Gone' }) }) };
    expect(has(problems(ghost), 'lists pages that do not exist: gone.md')).toBe(true);
    const files = wiki(pages);
    files['a.md'] = page({ summary: 'A different summary of what this page now covers in full.' });
    expect(has(problems(files), 'out of date for a.md')).toBe(true);
  });
  it('requires title, status, a real date and an opening paragraph', () => {
    const bad = (o: Parameters<typeof page>[0]) => problems(wiki({ 'a.md': page(o) }));
    expect(has(bad({ title: '' }).concat(problems(wiki({ 'a.md': 'Status: current\nLast verified: 2026-10-01\n\nno title' }))), 'no "# Title"')).toBe(true);
    expect(has(bad({ status: '' }), 'no "Status:" line')).toBe(true);
    expect(has(bad({ status: 'done' }), 'Status "done"')).toBe(true);
    expect(has(bad({ verified: '' }), 'no valid "Last verified')).toBe(true);
    expect(has(bad({ verified: '2026-13-45' }), 'no valid "Last verified')).toBe(true);
    expect(has(bad({ verified: '2027-01-01' }), 'is in the future')).toBe(true);
    expect(has(bad({ summary: 'short' }), 'shorter than 20 characters')).toBe(true);
    expect(has(bad({ summary: 'x'.repeat(301) }), 'over 300 characters')).toBe(true);
  });
  it('warns about a stale current page, but not a draft or a deprecated one', () => {
    const run = (status: string) => problems(wiki({ 'a.md': page({ status, verified: '2026-01-01' }) }));
    expect(has(run('current'), 'last verified 291 days ago (over 180)')).toBe(true);
    expect(has(run('draft'), 'days ago')).toBe(false);
    expect(has(run('deprecated'), 'days ago')).toBe(false);
    expect(has(problems(wiki({ 'a.md': page({ status: 'current', verified: '2026-01-01' }) }), { staleDays: 365 }), 'days ago')).toBe(false);
  });
  it('wants sources on a current page', () => {
    expect(has(problems(wiki({ 'a.md': page({ sources: '' }) })), 'cannot be re-verified')).toBe(true);
    expect(has(problems(wiki({ 'a.md': page({ sources: '', status: 'draft' }) })), 'cannot be re-verified')).toBe(false);
  });
  it('allows placeholders in a draft but not in a current page, ignoring code and comments', () => {
    const body = '## Rules\n\n- <fill in>';
    expect(has(problems(wiki({ 'a.md': page({ body }) })), 'template placeholders')).toBe(true);
    expect(has(problems(wiki({ 'a.md': page({ body, status: 'draft' }) })), 'template placeholders')).toBe(false);
    expect(has(problems(wiki({ 'a.md': page({ body: '## Rules\n\n`Array<string>` and\n```\n<x>\n```\n<!-- <y> -->' }) })), 'template placeholders')).toBe(false);
  });
  it('rejects secrets in any page', () => {
    for (const secret of ['AKIAABCDEFGHIJKLMNOP', 'ghp_' + 'a'.repeat(36), '-----BEGIN RSA PRIVATE KEY-----', 'password = "hunter2hunter2hunter2"', 'sk-' + 'a'.repeat(30)]) {
      expect(has(problems(wiki({ 'a.md': page({ body: `## Setup\n\n${secret}`, status: 'draft' }) })), 'appears to contain')).toBe(true);
    }
    expect(has(problems(wiki({ 'a.md': page({ body: '## Setup\n\nSet the password in the vault.' }) })), 'appears to contain')).toBe(false);
  });
  it('checks links inside the wiki, and outside it when it can', () => {
    const files = wiki({ 'a.md': page({ body: '## See\n\n[b](b.md), [c](sub/c.md#part), [site](https://x.dev), [here](#top), [gone](gone.md)' }), 'b.md': page({ title: 'B' }), 'sub/c.md': page({ title: 'C', body: '## Up\n\n[a](../a.md)' }) });
    const p = problems(files);
    expect(p.filter(x => x.includes('broken link'))).toEqual(['error:a.md:broken link: gone.md']);
    const outside = wiki({ 'a.md': page({ body: '## See\n\n[mission](../../MISSION.md) and [missing](../../NOPE.md)' }) });
    expect(has(problems(outside), 'broken link')).toBe(false);
    const checked = problems(outside, { exists: (rel: string) => rel === '../../MISSION.md' });
    expect(checked.filter(x => x.includes('broken link'))).toEqual(['error:a.md:broken link: ../../NOPE.md']);
  });
  it('holds decision records to their shape', () => {
    const good = wiki({ 'decisions/0002-use-queues.md': page({ title: 'Use queues', body: '## Context\n\nx\n\n## Decision\n\ny\n\n## Consequences\n\nz' }) });
    expect(problems(good)).toEqual([]);
    const bad = problems(wiki({ 'decisions/queues.md': page({ title: 'Queues' }) }));
    expect(has(bad, 'named decisions/NNNN-short-title.md')).toBe(true);
    expect(has(bad, 'has a "## Decision" section')).toBe(true);
  });
  it('warns about odd file names, duplicate titles and very long pages', () => {
    const p = problems(wiki({ 'My Page.md': page({ title: 'Same' }), 'other.md': page({ title: 'same' }), 'long.md': page({ title: 'Long', body: '## A\n' + 'line\n'.repeat(450) }) }));
    expect(has(p, 'kebab-case')).toBe(true);
    expect(has(p, 'is also used by')).toBe(true);
    expect(has(p, 'split it')).toBe(true);
  });
  it('lists errors before advice', () => {
    const list = checkWiki(wiki({ 'a.md': page({ sources: '', verified: '' }) }), { now: NOW });
    expect(list[0].severity).toBe('error');
    expect(list[list.length - 1].severity).toBe('warning');
  });
});

describe('scaffold and directories', () => {
  it('starts a draft page that fails as current until it is filled in', () => {
    const md = scaffold('Queues', '2026-10-19');
    expect(md).toContain('Status: draft');
    expect(parsePage('queues.md', md).title).toBe('Queues');
    const files = wiki({ 'queues.md': md });
    expect(problems(files)).toEqual([]);
    expect(has(problems(wiki({ 'queues.md': scaffold('Queues', '2026-10-19', 'current') })), 'template placeholders')).toBe(true);
  });
  it('finds the wiki directory and the staleness limit from the environment', () => {
    expect(wikiDir('/p', {})).toBe(path.join('/p', 'docs', 'wiki'));
    expect(wikiDir('/p', { FACTORY_WIKI_DIR: 'knowledge' })).toBe(path.join('/p', 'knowledge'));
    expect(staleDays({})).toBe(180);
    expect(staleDays({ FACTORY_WIKI_STALE_DAYS: '30' })).toBe(30);
    expect(staleDays({ FACTORY_WIKI_STALE_DAYS: 'soon' })).toBe(180);
  });
  it('reads markdown files recursively, with forward-slash paths, skipping hidden folders', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-read-'));
    fs.mkdirSync(path.join(d, 'a', 'b'), { recursive: true }); fs.mkdirSync(path.join(d, '.git'));
    fs.writeFileSync(path.join(d, 'x.md'), 'x'); fs.writeFileSync(path.join(d, 'a', 'b', 'y.md'), 'y');
    fs.writeFileSync(path.join(d, 'a', 'note.txt'), 'n'); fs.writeFileSync(path.join(d, '.git', 'z.md'), 'z');
    expect(Object.keys(readWiki(d)).sort()).toEqual(['a/b/y.md', 'x.md']);
    expect(readWiki(path.join(d, 'missing'))).toEqual({});
  });
});

describe('the skill and the template', () => {
  it('has an example page that passes every check', () => {
    const files = wiki({ 'payments-retries.md': exampleMd });
    expect(problems(files, { now: new Date('2026-10-20T00:00:00Z') })).toEqual([]);
  });
  it('ships a template wiki that passes its own checks and has an up-to-date index', () => {
    const files = readWiki(templateDir);
    expect(Object.keys(files).sort()).toEqual(['README.md', 'architecture/overview.md', 'decisions/0001-record-decisions.md', 'glossary.md', 'product.md']);
    const exists = (rel: string) => fs.existsSync(path.resolve(templateDir, rel));
    expect(checkWiki(files, { now: NOW, exists }).filter(i => i.severity === 'error')).toEqual([]);
  });
});

describe('the CLI', () => {
  const cli = path.join(root, '.factory', 'wiki-cli.ts');
  const tsnode = require.resolve('ts-node/dist/bin.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cli-'));
  const run = (args: string[]) => spawnSync(process.execPath, [tsnode, cli, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, FACTORY_WIKI_DIR: 'docs/wiki' } });
  const git = (...a: string[]) => spawnSync('git', a, { cwd: dir, encoding: 'utf-8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

  beforeAll(() => {
    git('init', '-q', '-b', 'main');
    fs.cpSync(templateDir, path.join(dir, 'docs', 'wiki'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'MISSION.md'), '# Mission\n');
  });

  it('says there is no wiki when there is none', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-none-'));
    const r = spawnSync(process.execPath, [tsnode, cli, 'check'], { cwd: empty, encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No wiki at');
  });
  it('checks a good wiki and fails a broken one', () => {
    const ok = run(['check']);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('0 error(s)');
    fs.writeFileSync(path.join(dir, 'docs', 'wiki', 'glossary.md'), page({ title: 'Glossary', summary: 'A different summary that the index does not know about yet.' }));
    const bad = run(['check']);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('the index is out of date');
    expect(JSON.parse(run(['check', '--json']).stdout).some((i: any) => i.severity === 'error')).toBe(true);
    expect(run(['index', '--write']).status).toBe(0);
    expect(run(['check']).status).toBe(0);
  });
  it('prints the index without writing it', () => {
    expect(run(['index']).stdout).toContain('| Page | Status | What it covers |');
  });
  it('starts a page, refreshes the index, and will not overwrite', () => {
    const r = run(['new', 'runbooks/restore-backup', 'Restore a backup']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('refreshed the index');
    expect(fs.readFileSync(path.join(dir, 'docs', 'wiki', 'runbooks', 'restore-backup.md'), 'utf-8')).toContain('# Restore a backup');
    expect(fs.readFileSync(path.join(dir, 'docs', 'wiki', 'README.md'), 'utf-8')).toContain('(runbooks/restore-backup.md)');
    expect(run(['new', 'runbooks/restore-backup', 'Again']).status).toBe(1);
    expect(run(['new', '../escape', 'Nope']).status).toBe(2);
    expect(run(['new', 'only-a-path']).status).toBe(2);
  });
  it('reports sources that changed since a page was verified', () => {
    fs.copyFileSync(path.join(templateDir, 'glossary.md'), path.join(dir, 'docs', 'wiki', 'glossary.md'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'retry.ts'), 'export {}\n');
    const file = path.join(dir, 'docs', 'wiki', 'payments.md');
    fs.writeFileSync(file, page({ sources: 'src/retry.ts; src/gone.ts; issue #1', verified: '2026-01-01' }));
    git('add', '-A');
    spawnSync('git', ['commit', '-q', '-m', 'chore: add retry', '--date=2026-03-01T00:00:00'], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: '2026-03-01T00:00:00', GIT_COMMITTER_DATE: '2026-03-01T00:00:00' } });
    const r = run(['drift']);
    expect(r.stdout).toContain('payments.md: src/retry.ts changed in 1 commit(s) since 2026-01-01');
    expect(r.stdout).toContain('payments.md: source src/gone.ts no longer exists');
    expect(r.stdout).toContain('2 source(s) to re-check');
    fs.writeFileSync(file, page({ sources: 'src/retry.ts', verified: '2026-06-01' }));
    expect(run(['drift']).stdout).toContain('no source has changed');
  });
  it('shows usage for an unknown command', () => {
    expect(run(['nonsense']).status).toBe(2);
  });
});

describe('the repository', () => {
  it('has the scripts and the commands', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
    expect(pkg.scripts.wiki).toBeDefined();
    expect(pkg.scripts['wiki:check']).toBeDefined();
    for (const c of ['wiki', 'wiki-check']) expect(fs.existsSync(path.join(root, '.claude', 'commands', `${c}.md`))).toBe(true);
  });
});

describe('a hyperlinked repository', () => {
  const long = (links: string) => page({ body: '## Rules\n\n' + Array.from({ length: 25 }, (_, i) => `- Rule number ${i}`).join('\n') + links });
  it('advises a long current page that links to nothing, but not a short one, a draft or a linked one', () => {
    const has2 = (files: Record<string, string>) => problems(files).some(x => x.includes('links to nothing'));
    expect(has2(wiki({ 'a.md': long('') }))).toBe(true);
    expect(has2(wiki({ 'a.md': page() }))).toBe(false);
    expect(has2(wiki({ 'a.md': page({ status: 'draft', body: '## Rules\n\n' + 'x\n'.repeat(25) }) }))).toBe(false);
    expect(has2(wiki({ 'a.md': long('\n\nSee [the code](../src/a.ts).'), }))).toBe(false);
  });
});
