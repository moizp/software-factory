import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createRunWorktree, commitAll, changedFiles } from '../worktree';
import { loopBack } from '../loopback';
import { invokeClaudeBuilder } from '../claude-bridge';

(async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-app-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf-8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'spike-app', version: '1.0.0' }));
  git('add', '-A'); git('commit', '-q', '-m', 'chore: scratch app');

  const wt = createRunWorktree(repo, 'spike-1', 'main');
  let totalTokens = 0, totalCost = 0, calls = 0;

  const task = 'Create add.js exporting a CommonJS function add(a, b) that returns a + b, and add.test.js using node:test and node:assert that tests it (positive, negative, zero). Only create those two files. Do not run anything.';

  const outcome = await loopBack({
    maxIterations: 2,
    attempt: async (i, feedback) => {
      const prompt = feedback ? `${task}\n\nThe gate failed with:\n${feedback}\nFix it.` : task;
      const r = await invokeClaudeBuilder(prompt, wt.dir, { maxBudgetUsd: 0.3, timeout: 240000 });
      calls++; totalTokens += r.usage?.totalTokens ?? 0; totalCost += r.usage?.costUsd ?? 0;
      console.log(`attempt ${i}: ${r.usage?.totalTokens} tokens, turns ${r.usage?.turns}, reply: ${r.text.slice(0, 120).replace(/\n/g, ' ')}`);
      const sha = commitAll(wt, `feat: builder attempt ${i}`);
      console.log(`  committed: ${sha ? sha.slice(0, 7) : 'nothing changed'}`);
    },
    gate: async () => {
      const t = spawnSync('node', ['--test'], { cwd: wt.dir, encoding: 'utf-8' });
      const passed = t.status === 0;
      console.log(`  gate: ${passed ? 'PASS' : 'FAIL'}`);
      return { passed, feedback: passed ? '' : (t.stdout + t.stderr).slice(0, 1500) };
    }
  });

  console.log(JSON.stringify({ status: outcome.status, iterations: outcome.iterations, calls, totalTokens, apiEquivalentUsd: totalCost.toFixed(4) }));
  console.log('files changed vs main:', changedFiles(wt, 'main'));
  console.log('commits:', git('log', '--format=%h %s', 'main..factory/spike-1').trim().split('\n'));
  console.log('main checkout untouched:', !fs.existsSync(path.join(repo, 'add.js')));
})().catch(e => { console.error('SPIKE ERROR', e.message); process.exit(1); });
