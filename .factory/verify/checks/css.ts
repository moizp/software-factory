import * as fs from 'fs';
import * as path from 'path';
import { checkDevEx } from '../../devex';
import { Check, Ctx, fail, pass, skip } from '../types';

const budgetScript = (ctx: Ctx): string => path.join(ctx.factoryRoot, 'templates', 'web-app', 'scripts', 'css-budget.cjs');

export const webAppChecks: Check[] = [
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
