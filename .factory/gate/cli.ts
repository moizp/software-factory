#!/usr/bin/env node
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { loadPolicy, prInfoFromGit } from '../policy-engine';
import { lintPr, renderSummary } from './pr-lint';

// Usage: gate-cli --base <ref> --head <ref> --branch <name> --title <text> --body-file <path> [--strict]
// Policy and code come from the base branch. Exit 1 on errors (or on any warning with --strict).

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = arg('base');
const head = arg('head');
const branch = arg('branch');
const title = arg('title');
const bodyFile = arg('body-file');
if (!base || !head || !branch || title === undefined || !bodyFile) {
  console.error('Usage: gate-cli --base <ref> --head <ref> --branch <name> --title <text> --body-file <path> [--strict]');
  process.exit(2);
}

const info = prInfoFromGit(base, head, branch);
const commitLog = execFileSync('git', ['log', '--format=%B%x00', `${base}..${head}`], { encoding: 'utf-8' });
const commits = commitLog.split('\u0000').map(c => c.trim()).filter(Boolean);

const report = lintPr({
  title,
  body: fs.readFileSync(bodyFile, 'utf-8'),
  commits,
  files: info.files,
  changedLines: info.changedLines,
  policy: loadPolicy(base)
});

console.log(renderSummary(report));
const strict = process.argv.includes('--strict');
process.exit(report.errors.length > 0 || (strict && report.warnings.length > 0) ? 1 : 0);
