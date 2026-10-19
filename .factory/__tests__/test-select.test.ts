import { isDocsOnly, selectTests, testsReading, TestFile } from '../gate/test-select';

const tests: TestFile[] = [
  { path: '.factory/__tests__/mission.test.ts', source: "path.join(root, '.claude', 'skills', 'mission.md')" },
  { path: '.factory/__tests__/writer-commands.test.ts', source: "path.join(root, '.claude', 'commands')" },
  { path: '.factory/__tests__/sweep.test.ts', source: "path.join(__dirname, '..', '..', '.github', 'workflows', 'sweep.yml')" },
  { path: '.factory/__tests__/state.test.ts', source: "import { saveWorkflowState } from '../state'" }
];

describe('isDocsOnly', () => {
  it('treats docs/ and root markdown as docs, nothing else', () => {
    expect(isDocsOnly('docs/POLICY.md')).toBe(true);
    expect(isDocsOnly('README.md')).toBe(true);
    expect(isDocsOnly('.claude/skills/mission.md')).toBe(false);
    expect(isDocsOnly('templates/project/MISSION.md')).toBe(false);
  });
});

describe('testsReading', () => {
  it('matches a test that names the file', () => {
    expect(testsReading('.claude/skills/mission.md', tests)).toEqual(['.factory/__tests__/mission.test.ts']);
    expect(testsReading('.github/workflows/sweep.yml', tests)).toEqual(['.factory/__tests__/sweep.test.ts']);
  });
  it('matches a test that reads the whole directory', () => {
    expect(testsReading('.claude/commands/new-command.md', tests)).toEqual(['.factory/__tests__/writer-commands.test.ts']);
  });
  it('matches nothing for a file no test reads', () => {
    expect(testsReading('scripts/unrelated.sh', tests)).toEqual([]);
  });
  it('does not match on a root file with no directory', () => {
    expect(testsReading('.gitignore', tests)).toEqual([]);
  });
});

describe('selectTests', () => {
  it('runs nothing for docs-only changes', () => {
    expect(selectTests(['docs/POLICY.md', 'README.md'], tests).mode).toBe('none');
  });
  it('runs nothing when no test reads the changed files', () => {
    expect(selectTests(['scripts/unrelated.sh'], tests).mode).toBe('none');
  });
  it('runs everything when a file that shapes every test run changes', () => {
    for (const f of ['package.json', 'package-lock.json', 'jest.config.js', 'tsconfig.json', '.nvmrc', '.github/workflows/factory-test.yml', '.factory/__tests__/setup-env.ts']) {
      expect(selectTests(['docs/a.md', f], tests).mode).toBe('full');
    }
  });
  it('selects related tests for changed source files', () => {
    const sel = selectTests(['.factory/state.ts', 'docs/a.md'], tests);
    expect(sel).toMatchObject({ mode: 'related', files: ['.factory/state.ts'], tests: [] });
  });
  it('adds the tests that read changed prompts, templates and workflows', () => {
    const sel = selectTests(['.factory/state.ts', '.claude/skills/mission.md', '.github/workflows/sweep.yml'], tests);
    expect(sel).toMatchObject({
      mode: 'related',
      files: ['.factory/state.ts', '.factory/__tests__/mission.test.ts', '.factory/__tests__/sweep.test.ts'],
      tests: ['.factory/__tests__/mission.test.ts', '.factory/__tests__/sweep.test.ts']
    });
  });
  it('ignores declaration files and duplicates, and normalises paths', () => {
    expect(selectTests(['.factory/types.d.ts'], tests).mode).toBe('none');
    const sel = selectTests(['./.factory/state.ts', '.factory/state.ts'], tests);
    expect(sel).toMatchObject({ mode: 'related', files: ['.factory/state.ts'] });
  });
});
