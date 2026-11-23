import * as fs from 'fs';
import * as path from 'path';
import { checkProject, parseBoundaries, renderReport } from '../../boundaries';
import { loadStack, renderStackLine } from '../../stack';
import { Check, fail, pass, skip } from '../types';

export const stackChecks: Check[] = [
  {
    id: 'project.stack',
    tier: 'offline',
    title: 'The stack agents will be told',
    run: ctx => {
      const s = loadStack(ctx.projectDir);
      return pass(renderStackLine(s), s.frontendIsDefault ? 'no frontend declared in project.config.json: SvelteKit with TypeScript is used' : undefined);
    }
  },
  {
    id: 'project.boundaries',
    tier: 'offline',
    title: 'Shared code is framework-agnostic: the core imports no framework and no outside package',
    run: ctx => {
      let raw: Record<string, unknown> = {};
      const file = path.join(ctx.projectDir, 'project.config.json');
      if (fs.existsSync(file)) { try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return skip('project.config.json is not valid JSON'); } }
      const b = parseBoundaries(raw.boundaries);
      if (!b.ok) return fail(b.error, undefined, 'Fix "boundaries" in project.config.json (docs/CONFIGURATION.md)');
      const report = checkProject(ctx.projectDir, b.value);
      if (report.files === 0 && report.violations.length === 0) return skip(`no files match ${b.value.core.join(', ')} yet`, 'Shared code goes in src/lib/core (plain TypeScript); the check starts once it exists');
      return report.violations.length === 0 ? pass(renderReport(report)) : fail(`${report.violations.length} violation(s)`, renderReport(report), 'Move the framework code to an adapter and pass what the core needs in as arguments (.claude/skills/principles.md, principle 2)');
    }
  }
];
