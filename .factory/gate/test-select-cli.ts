#!/usr/bin/env node
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { selectTests, TestFile } from './test-select';

// Usage: test-select-cli [--base <ref>] [--list]
// Runs the tests a change needs: the tests related to changed source files plus the tests that read changed
// prompts, templates or workflows. --list prints the choice and stops. Exit code is jest's.
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = flag('--base') ?? 'origin/main';
const root = path.resolve(__dirname, '..', '..');

function collectTests(dir: string): TestFile[] {
  const out: TestFile[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectTests(p));
    else if (e.name.endsWith('.test.ts')) out.push({ path: path.relative(root, p).replace(/\\/g, '/'), source: fs.readFileSync(p, 'utf-8') });
  }
  return out;
}

const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`], { cwd: root, encoding: 'utf-8' })
  .split('\n').filter(Boolean);
const sel = selectTests(changed, collectTests(path.join(root, '.factory', '__tests__')));
console.log(`test selection: ${sel.mode} (${sel.reason})`);
if (sel.mode === 'related') sel.files.forEach(f => console.log(`  ${f}`));
if (args.includes('--list') || sel.mode === 'none') process.exit(0);

const jest = require.resolve('jest/bin/jest');
const jestArgs = sel.mode === 'full' ? [] : ['--findRelatedTests', ...sel.files, '--passWithNoTests'];
process.exit(spawnSync(process.execPath, [jest, ...jestArgs], { cwd: root, stdio: 'inherit' }).status ?? 1);
