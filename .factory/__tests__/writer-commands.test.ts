import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkEvidence } from '../gate/evidence';
import { COMMIT_TYPES, HARD_LIMIT, SOFT_LIMIT, lintCommitMessage, renderCommitReport } from '../gate/commit-lint';
import { lintProse } from '../gate/prose-lint';

const root = path.join(__dirname, '..', '..');
const commandsDir = path.join(root, '.claude', 'commands');
const NAMES = ['character-check', 'character', 'commit', 'debug', 'describe-pr', 'handoff', 'iterate-plan', 'lookfeel-check', 'lookfeel', 'mission-check', 'mission', 'resume-handoff', 'wiki-check', 'wiki'];
const read = (n: string) => fs.readFileSync(path.join(commandsDir, `${n}.md`), 'utf-8');
const frontmatter = (n: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(read(n));
  expect(m).not.toBeNull();
  return Object.fromEntries(m![1].split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
};
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).scripts as Record<string, string>;

describe('commit message rules', () => {
  const bad = (m: string) => lintCommitMessage(m).errors;
  it('accepts the documented examples', () => {
    for (const m of ['feat: add mcp-configurator agent', 'fix: resolve parallel phase artifacts', 'docs: update contributing guide', 'refactor(route): split the sweep']) {
      expect(lintCommitMessage(m)).toEqual({ errors: [], warnings: [] });
    }
  });
  it('rejects what CONTRIBUTING.md forbids', () => {
    expect(bad('Added mcp configurator')[0]).toContain('type: description');
    expect(bad('fixes stuff')[0]).toContain('type: description');
    expect(bad('feature: add a thing').join()).toContain('unknown type "feature"');
    expect(bad('feat: add a thing.').join()).toContain('trailing punctuation');
    expect(bad('feat: add a thing\n\nlonger body').join()).toContain('single line');
    expect(bad('feat: add a thing\n\nCo-Authored-By: Claude <x@y.z>').join()).toContain('attribution');
    expect(bad('')).toEqual(['the message is empty']);
    expect(bad('feat: ' + 'x'.repeat(HARD_LIMIT)).join()).toContain('limit is 72');
  });
  it('warns, not fails, between 50 and 72 characters and on a capital', () => {
    const long = lintCommitMessage('feat: ' + 'x'.repeat(SOFT_LIMIT));
    expect(long.errors).toEqual([]);
    expect(long.warnings.join()).toContain('aim for 50');
    expect(lintCommitMessage('feat: Add a thing').warnings.join()).toContain('lower case');
  });
  it('treats attribution as an error even in the subject', () => {
    expect(bad('chore: generated with Claude Code').join()).toContain('attribution');
  });
  it('renders a short report', () => {
    expect(renderCommitReport(lintCommitMessage('feat: ok'))).toBe('Commit message: no issues.');
    expect(renderCommitReport(lintCommitMessage('nope'))).toContain('- error:');
  });
  it('the CLI exits 1 on errors and 0 otherwise', () => {
    const run = (m: string) => spawnSync('npx', ['ts-node', '.factory/gate/commit-cli.ts', m], { cwd: root, encoding: 'utf-8' });
    expect(run('feat: add a thing').status).toBe(0);
    const failed = run('Added a thing.');
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('error');
  });
});

describe('the writer commands', () => {
  it('are exactly the ones the docs list', () => {
    expect(fs.readdirSync(commandsDir).sort()).toEqual(NAMES.map(n => `${n}.md`));
  });

  it.each(NAMES)('%s has a description and the tools it needs', n => {
    const fm = frontmatter(n);
    expect(fm.description.length).toBeGreaterThan(20);
    expect(fm['allowed-tools']).toBeTruthy();
  });

  it.each(NAMES)('%s reads like the rest of the repo (no em dashes, filler or chatbot phrasing)', n => {
    expect(lintProse(read(n)).filter(v => v.severity === 'warning')).toEqual([]);
    expect(read(n)).not.toContain('—');
  });

  it.each(NAMES)('%s only names npm scripts that exist', n => {
    const used = [...read(n).matchAll(/npm run ([a-z]+(?::[a-z]+)*)/g)].map(m => m[1]);
    for (const script of used) expect(scripts[script]).toBeDefined();
  });

  it('every shell command a command pre-runs is allowed by its own tool list', () => {
    for (const n of NAMES) {
      const allowed = frontmatter(n)['allowed-tools'];
      for (const m of read(n).matchAll(/!`([^`]+)`/g)) {
        const [tool, sub] = m[1].split(/\s+/);
        expect(allowed).toContain(`Bash(${tool} ${sub}`);
      }
    }
  });

  it('/commit lists the same types and limits as the checker, and never stages everything', () => {
    const md = read('commit');
    for (const t of COMMIT_TYPES) expect(md).toContain(`\`${t}\``);
    expect(md).toContain(String(SOFT_LIMIT));
    expect(md).toContain(String(HARD_LIMIT));
    expect(md).toContain('npm run gate:commit');
    expect(md).toMatch(/Never `git add -A`/);
    expect(md).toContain('No attribution');
  });

  it('/describe-pr template satisfies the evidence check at the highest tier', () => {
    const md = read('describe-pr');
    const template = /```markdown\n([\s\S]*?)```/.exec(md)![1];
    const headings = [...template.matchAll(/^## (.+)$/gm)].map(m => m[1]);
    expect(headings).toEqual(['What', 'Why', 'Out of scope', 'Risk', 'Testing', 'Rollback']);
    const filled = headings.map(h => `## ${h}\nThe check \`npm test\` passed with 418 passed and the result was recorded.`).join('\n\n');
    expect(checkEvidence(filled, 'R3')).toEqual([]);
    // With the sections left empty the same checker complains, so the template cannot pass by being left alone
    const empty = headings.map(h => `## ${h}\n`).join('\n');
    expect(checkEvidence(empty, 'R3').map(i => i.rule)).toEqual(expect.arrayContaining(['evidence-missing', 'rollback-missing']));
  });

  it('/describe-pr calls the PR text check with the flags it needs', () => {
    const md = read('describe-pr');
    for (const flag of ['--base', '--head', '--branch', '--title', '--body-file']) expect(md).toContain(flag);
    expect(md).toContain('npm run policy:check');
  });

  it('/debug asks for a cause and a failing test before any edit', () => {
    const md = read('debug');
    expect(md.indexOf('Reproduce')).toBeLessThan(md.indexOf('Write the test that fails'));
    expect(md.indexOf('Write the test that fails')).toBeLessThan(md.indexOf('Fix the cause'));
    expect(md).toContain('Do not edit code until step 4');
  });

  it('/iterate-plan does not start the build', () => {
    expect(read('iterate-plan')).toContain('No code in this step');
  });
});

describe('workspace scripts', () => {
  const bootstrap = fs.readFileSync(path.join(root, 'templates', 'workspace', 'bootstrap.sh'), 'utf-8');
  it('bootstrap installs the commands from the repo', () => {
    expect(bootstrap).toContain('.claude/commands');
    expect(bootstrap).toContain('$HOME/.claude/commands');
  });

  it('doctor reports missing or changed commands and passes once they match', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
    const doctor = () => spawnSync('bash', [path.join(root, 'templates', 'workspace', 'doctor.sh')], {
      env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf-8'
    }).stdout;

    expect(doctor()).toContain('writer commands missing or out of date: /character-check /character /commit /debug /describe-pr /handoff /iterate-plan /lookfeel-check /lookfeel /mission-check /mission /resume-handoff /wiki-check /wiki');

    fs.mkdirSync(path.join(home, '.claude', 'commands'), { recursive: true });
    for (const n of NAMES) fs.copyFileSync(path.join(commandsDir, `${n}.md`), path.join(home, '.claude', 'commands', `${n}.md`));
    expect(doctor()).toContain('ok    writer commands installed and current');

    fs.appendFileSync(path.join(home, '.claude', 'commands', 'commit.md'), 'local edit\n');
    expect(doctor()).toContain('out of date: /commit');
  });
});
