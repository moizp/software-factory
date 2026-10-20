#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { exec } from './verify/exec';
import { ALL_CHECKS, runChecks, tiersFor } from './verify';
import { Meta, exitCode, renderReport, counts } from './verify/report';
import { redact } from './verify/redact';
import { Ctx, Flags, Row } from './verify/types';

// Usage: verify [--project <dir>] [--quick] [--live[=plan]] [--github] [--issue <n>] [--create-labels]
//               [--brief "<text>"] [--cap <tokens>] [--out <file>] [--only <id-prefix>] [--list]
//   default   environment, offline checks and a model-free run of the whole pipeline (no tokens, no network)
//   --quick   skip the factory's own test suite
//   --live    also run the real product manager once (--live=plan: through the architect); spends tokens
//   --github  also look at the repository through gh (read-only); --create-labels adds the missing labels
const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
const value = (name: string): string | undefined => {
  const i = argv.findIndex(a => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1];
};

const factoryRoot = path.resolve(__dirname, '..');
const liveArg = argv.find(a => a === '--live' || a.startsWith('--live='));
const flags: Flags = {
  quick: flag('--quick'),
  live: !liveArg ? false : liveArg === '--live=plan' ? 'plan' : 'requirements',
  github: flag('--github'),
  issue: value('--issue') ? Number(value('--issue')) : undefined,
  createLabels: flag('--create-labels'),
  brief: value('--brief') ?? 'A small invoicing app so freelancers get paid on time',
  tokenCap: Number(value('--cap') ?? 150_000)
};
if (flags.issue !== undefined && !Number.isInteger(flags.issue)) { console.error('--issue needs a number'); process.exit(2); }
if (flags.issue) flags.github = true;
if (flags.createLabels) flags.github = true;

const ctx: Ctx = { factoryRoot, projectDir: path.resolve(value('--project') ?? process.cwd()), flags };
const only = value('--only');
const selected = ALL_CHECKS.filter(c => tiersFor(ctx).includes(c.tier) && (!only || c.id.startsWith(only)));

if (flag('--list')) {
  for (const c of ALL_CHECKS) console.log(`${c.id.padEnd(26)} ${c.tier.padEnd(8)} ${c.title}`);
  process.exit(0);
}

const out = path.resolve(value('--out') ?? path.join(ctx.projectDir, 'verify-report.md'));
const version = (cmd: string): string => { const r = exec(cmd, ['--version'], { timeoutMs: 15_000 }); return r.missing || r.code !== 0 ? 'not installed' : r.stdout.trim().split('\n')[0].replace(/^gh version /, ''); };
const git = (args: string[]): string => { const r = exec('git', args, { cwd: factoryRoot, timeoutMs: 15_000 }); return r.code === 0 ? r.stdout.trim() : 'unknown'; };

const mark = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' } as const;
const show = (r: Row): void => console.log(`${mark[r.status]}  ${r.id.padEnd(26)} ${redact(r.detail).slice(0, 110)}  (${(r.ms / 1000).toFixed(1)} s)`);

(async () => {
  console.log(`Verifying ${ctx.projectDir} with the factory at ${factoryRoot}\n`);
  const rows = await runChecks(ctx, selected, show);
  const meta: Meta = {
    generatedAt: new Date().toISOString(),
    factoryCommit: git(['rev-parse', '--short', 'HEAD']),
    factoryBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    node: process.versions.node,
    os: `${process.platform} ${process.arch}`,
    claude: version('claude'),
    gh: version('gh'),
    projectDir: ctx.projectDir,
    tiers: [...new Set(selected.map(c => c.tier))],
    flags: argv.filter(a => a !== '--list').join(' ')
  };
  const report = renderReport(meta, rows);
  fs.writeFileSync(out, report + '\n');
  const c = counts(rows);
  console.log(`\n${c.pass} pass, ${c.warn} warn, ${c.fail} fail, ${c.skip} skip. Report: ${out}`);
  console.log('\nPaste everything between the two markers below into the session:\n');
  console.log(report);
  process.exit(exitCode(rows));
})().catch(e => { console.error(redact(String(e?.stack ?? e))); process.exit(2); });
