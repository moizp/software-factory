import * as fs from 'fs';
import * as path from 'path';
import { checkDependencies } from '../../deps';
import { checkDevEx } from '../../devex';
import { addCommand, checkMcp, serversFor } from '../../mcp';
import { loadStack } from '../../stack';
import { loadUiRules } from '../../uirules';
import { Check, Ctx, fail, pass, skip, warn } from '../types';

const budgetScript = (ctx: Ctx): string => path.join(ctx.factoryRoot, 'templates', 'web-app', 'scripts', 'css-budget.cjs');

export const webAppChecks: Check[] = [
  {
    id: 'project.deps',
    tier: 'offline',
    title: 'Few dependencies: each one is another package to keep updated',
    run: ctx => {
      const r = checkDependencies(ctx.projectDir);
      if (!r.applicable) return skip('no package.json');
      const counts = `${r.runtime} runtime and ${r.dev} dev package(s); budget ${r.budget.runtime} and ${r.budget.dev}`;
      return r.over.length === 0
        ? pass(counts)
        : warn(`over budget: ${r.over.join('; ')}`, counts, 'Remove a package or write the small piece in-house; keep one only if the plan\'s new_dependencies says why (.claude/skills/developer-experience.md)');
    }
  },
  {
    id: 'project.mcp',
    tier: 'offline',
    title: 'The MCP servers the stack calls for are configured (the Svelte MCP for a Svelte app)',
    run: ctx => {
      const stack = loadStack(ctx.projectDir);
      const r = checkMcp(ctx.projectDir, stack);
      if (!r.applicable) return skip('not a SvelteKit app: no stack-specific MCP servers to check', 'A SvelteKit app registers the Svelte MCP in .mcp.json (templates/web-app/.mcp.json)');
      const wanted = serversFor(stack);
      if (r.missingRequired.length) {
        const cmds = wanted.filter(s => r.missingRequired.includes(s.id)).map(addCommand);
        return fail(`missing: ${r.missingRequired.join(', ')}`, cmds.join('\n'), 'Copy templates/web-app/.mcp.json to the project root, or run the command shown (.claude/skills/mcp-setup.md)');
      }
      if (r.unpinned.length) return warn(`not pinned to a version: ${r.unpinned.join(', ')}`, undefined, 'Pin the package version in .mcp.json so a bump is a reviewed change');
      const optional = r.missingOptional.length ? `; optional, not configured: ${r.missingOptional.join(', ')}` : '';
      return pass(`${wanted.filter(s => s.level === 'required').map(s => s.id).join(', ')} configured${optional}`);
    }
  },
  {
    id: 'project.devex',
    tier: 'offline',
    title: 'Developer experience: formatting, class and import order, linting, check:all, local environment',
    run: ctx => {
      const r = checkDevEx(ctx.projectDir);
      if (!r.applicable) return skip('not a SvelteKit app: nothing to check', 'A web app starts from templates/web-app/ (docs/GETTING-STARTED.md)');
      return r.issues.length === 0
        ? pass('Prettier sorts classes and imports, ESLint, check:all, doctor, .env.example and editor settings are in place')
        : fail(`${r.issues.length} gap(s)`, r.issues.map(i => `- ${i.message}\n  fix: ${i.fix}`).join('\n'), 'Start from templates/web-app/ (.claude/skills/developer-experience.md)');
    }
  },
  {
    id: 'project.css',
    tier: 'offline',
    title: 'CSS stays within its budget',
    run: ctx => {
      if (!fs.existsSync(path.join(ctx.projectDir, 'src'))) return skip('no src directory: nothing to measure yet');
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(fs.readFileSync(path.join(ctx.projectDir, 'project.config.json'), 'utf-8')).css_budget ?? {}; } catch { /* defaults */ }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const script = require(budgetScript(ctx)) as { check(root: string, c: Record<string, unknown>): { violations: Array<{ message: string; file?: string }> }; render(r: unknown): string };
      const r = script.check(ctx.projectDir, config);
      return r.violations.length === 0 ? pass(script.render(r)) : fail(`${r.violations.length} problem(s)`, script.render(r), 'Use Tailwind utilities or a shared component; never raise a budget to pass (.claude/skills/styling.md)');
    }
  },
  {
    id: 'project.layout',
    tier: 'offline',
    title: 'Crowding and overlap: UI rules, layout guard, compatibility gate, and the settings only the owner can give',
    run: ctx => {
      const src = path.join(ctx.projectDir, 'src');
      if (!fs.existsSync(src)) return skip('no src directory: nothing to guard yet');
      const missing = ['scripts/layout-guard.cjs', 'scripts/css-compat.cjs'].filter(f => !fs.existsSync(path.join(ctx.projectDir, f)));
      if (missing.length) return fail(`missing: ${missing.join(', ')}`, undefined, 'Copy scripts/ from templates/web-app/ (templates/web-app/README.md)');
      const rules = loadUiRules(ctx.projectDir);
      if ('error' in rules) return fail(rules.error, undefined, 'Fix UI-RULES.md: each rule is a line like "- R1: text" (templates/web-app/UI-RULES.md)');
      const notes: string[] = [];
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(ctx.projectDir, 'project.config.json'), 'utf-8')); } catch { /* none */ }
      if (!cfg.browser_targets) notes.push('browser_targets is not set (the oldest browsers the app must work in): ask the owner, because compat:check fails without it');
      if (!cfg.git_identity) notes.push('git_identity is not set (name and email for author and committer): ask the owner; the identity gate checks nothing until it is');
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(ctx.projectDir, 'layout-guard.config.json'), 'utf-8'));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const guard = require(path.join(ctx.factoryRoot, 'templates', 'web-app', 'scripts', 'layout-guard.cjs')) as { resolveConfig(r: unknown): { ignored: string[] } };
        notes.push(...guard.resolveConfig(raw).ignored.map(n => `layout-guard.config.json: ${n}`));
      } catch { /* no config: the stated minimums apply */ }
      const rows = (function count(dir: string): number {
        return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => e.isDirectory() ? n + count(path.join(dir, e.name)) : /\.(svelte|html|ts|js)$/.test(e.name) ? n + (fs.readFileSync(path.join(dir, e.name), 'utf-8').match(/data-layout-row/g) ?? []).length : n, 0);
      })(src);
      if (rows === 0) notes.push('no row of controls is marked data-layout-row yet (the guard fails on a page with none)');
      const head = `${rules.rules.rules.length} UI rules (${rules.rules.source}), ${rows} row(s) marked`;
      return notes.length ? warn(head, notes.map(n => `- ${n}`).join('\n'), 'Answer the owner questions in .claude/skills/layout-guard.md') : pass(head);
    }
  }
];
