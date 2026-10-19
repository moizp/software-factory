import * as path from 'path';

// Picks which tests a change needs. Pull requests run only these; the full suite runs on main on a schedule
// (see .github/workflows/factory-test.yml). Pure so it can be tested without git or jest.

export interface TestFile { path: string; source: string }

export type Selection =
  | { mode: 'none'; reason: string }
  | { mode: 'full'; reason: string }
  | { mode: 'related'; files: string[]; tests: string[]; reason: string };

/** Files that change how every test runs. A change to one of these runs everything. */
export const FULL_RUN_FILES = [
  'package.json',
  'package-lock.json',
  'jest.config.js',
  'tsconfig.json',
  '.nvmrc',
  '.github/workflows/factory-test.yml',
  '.factory/gate/test-select.ts',
  '.factory/__tests__/setup-env.ts'
];

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** Documentation nobody's tests read: everything under docs/ and markdown at the repo root. */
export function isDocsOnly(file: string): boolean {
  const f = norm(file);
  return f.startsWith('docs/') || (!f.includes('/') && f.endsWith('.md'));
}

const isSource = (f: string) => f.startsWith('.factory/') && f.endsWith('.ts') && !f.endsWith('.d.ts');

/**
 * Tests read prompts, skills, templates and workflows from disk, so jest's module graph cannot see them. A test counts
 * as reading a changed file when its source names the file, or names the directory the file sits in as a quoted string.
 * Over-selecting is fine; the scheduled full run catches anything this misses.
 */
export function testsReading(file: string, tests: TestFile[]): string[] {
  const f = norm(file);
  const base = path.posix.basename(f);
  const dir = path.posix.dirname(f);
  const parent = dir === '.' ? '' : path.posix.basename(dir);
  return tests
    .filter(t => t.source.includes(base) || (parent !== '' && (t.source.includes(`'${parent}'`) || t.source.includes(`"${parent}"`))))
    .map(t => t.path);
}

export function selectTests(changed: string[], tests: TestFile[]): Selection {
  const files = [...new Set(changed.map(norm).filter(Boolean))];
  const trigger = files.find(f => FULL_RUN_FILES.includes(f));
  if (trigger) return { mode: 'full', reason: `${trigger} changes how every test runs` };

  const sources = files.filter(isSource);
  const readTests = new Set<string>();
  for (const f of files) {
    if (isSource(f) || isDocsOnly(f)) continue;
    for (const t of testsReading(f, tests)) readTests.add(t);
  }
  if (sources.length === 0 && readTests.size === 0) {
    return { mode: 'none', reason: 'no changed file is code or is read by a test' };
  }
  return {
    mode: 'related',
    files: [...sources, ...[...readTests].sort()],
    tests: [...readTests].sort(),
    reason: `${sources.length} changed source file(s), ${readTests.size} test(s) that read changed files`
  };
}
