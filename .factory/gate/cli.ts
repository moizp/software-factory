#!/usr/bin/env node
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { loadPolicy, prInfoFromGit } from '../policy-engine';
import { parseIdentity } from './layout';
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

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

// The identity the owner specified: FACTORY_GIT_IDENTITY="Name <email>", or git_identity in project.config.json on the base branch
function expectedIdentity() {
  const fromEnv = parseIdentity(process.env.FACTORY_GIT_IDENTITY);
  if (fromEnv) return fromEnv;
  try {
    const g = JSON.parse(git('show', `${base}:project.config.json`)).git_identity;
    return g && g.name && g.email ? { name: String(g.name), email: String(g.email) } : null;
  } catch { return null; }
}
const commitIdentities = git('log', '--format=%an%x1f%ae%x1f%cn%x1f%ce%x1f%s%x00', `${base}..${head}`)
  .split('\u0000').map(c => c.trim()).filter(Boolean).map(c => {
    const [authorName, authorEmail, committerName, committerEmail, subject] = c.split('\u001f');
    return { authorName, authorEmail, committerName, committerEmail, subject: subject ?? '' };
  });

const report = lintPr({
  title,
  body: fs.readFileSync(bodyFile, 'utf-8'),
  commits,
  files: info.files,
  changedLines: info.changedLines,
  policy: loadPolicy(base),
  branch,
  diff: git('diff', '--unified=0', '--no-renames', `${base}...${head}`),
  addedFiles: git('diff', '--name-only', '--diff-filter=AM', '--no-renames', `${base}...${head}`).split('\n').filter(Boolean),
  commitIdentities,
  identity: expectedIdentity()
});

console.log(renderSummary(report));
const strict = process.argv.includes('--strict');
process.exit(report.errors.length > 0 || (strict && report.warnings.length > 0) ? 1 : 0);
