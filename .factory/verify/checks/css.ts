import * as fs from 'fs';
import * as path from 'path';
import { checkDependencies } from '../../deps';
import { checkDevEx } from '../../devex';
import { addCommand, checkMcp, serversFor } from '../../mcp';
import { loadStack } from '../../stack';
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
  }
];
