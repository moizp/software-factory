import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../exec';
import { Check, fail, pass, skip, warn } from '../types';

const firstLine = (s: string): string => s.trim().split('\n')[0] ?? '';

export const envChecks: Check[] = [
  {
    id: 'env.node',
    tier: 'env',
    title: 'Node 24',
    run: () => {
      const major = Number(process.versions.node.split('.')[0]);
      return major === 24
        ? pass(`Node ${process.versions.node}`)
        : fail(`Node ${process.versions.node}; the factory supports Node 24 only`, undefined, 'Install Node 24 (`nvm install` reads .nvmrc), then run `npm install` again');
    }
  },
  {
    id: 'env.git',
    tier: 'env',
    title: 'git is installed and the project is a repository',
    run: ctx => {
      const v = exec('git', ['--version']);
      if (v.missing) return fail('git is not installed', undefined, 'Install git');
      const inside = exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ctx.projectDir });
      return inside.code === 0 ? pass(firstLine(v.stdout)) : warn(`${firstLine(v.stdout)}, but ${ctx.projectDir} is not a git repository`, undefined, 'Run the factory inside a git repository: branches and pull requests need one');
    }
  },
  {
    id: 'env.deps',
    tier: 'env',
    title: 'Dependencies are installed',
    run: ctx => {
      const missing = ['ajv', 'chalk', 'ts-node', 'typescript', 'jest'].filter(p => !fs.existsSync(path.join(ctx.factoryRoot, 'node_modules', p)));
      return missing.length === 0 ? pass('ajv, chalk, ts-node, typescript and jest are present') : fail(`missing: ${missing.join(', ')}`, undefined, 'Run `npm install` in the factory directory');
    }
  },
  {
    id: 'env.claude',
    tier: 'env',
    title: 'claude CLI is installed',
    run: () => {
      const v = exec('claude', ['--version'], { timeoutMs: 20_000 });
      if (v.missing) return warn('claude CLI not found; mock and offline checks still run, real agent runs need it', undefined, 'Install Claude Code and log in with `claude`, then re-run with `--live`');
      return v.code === 0 ? pass(firstLine(v.stdout)) : warn(`claude --version exited ${v.code}`, v.stderr);
    }
  },
  {
    id: 'env.gh',
    tier: 'env',
    title: 'gh CLI is installed (only the --github checks need it)',
    run: ctx => {
      const v = exec('gh', ['--version']);
      if (v.missing) return ctx.flags.github ? fail('gh CLI not found', undefined, 'Install the GitHub CLI and run `gh auth login`') : skip('gh CLI not found; only needed for --github');
      return pass(firstLine(v.stdout));
    }
  }
];
