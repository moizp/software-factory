import * as fs from 'fs';
import * as path from 'path';

/**
 * Every package a project depends on is one more to keep updated, audited and patched for as long as the project lives.
 * Fewer packages means less of that, so the count is shown and capped. Over the cap is a warning, not a failure: a
 * package that earns its place is named in the plan's `new_dependencies` with why the in-house alternative lost.
 */

export interface DependencyBudget {
  /** Packages in `dependencies`: what ships. */
  runtime: number;
  /** Packages in `devDependencies`: build, format, lint and test tools. */
  dev: number;
}

export const DEFAULT_BUDGET: DependencyBudget = { runtime: 15, dev: 30 };

export interface DependencyReport {
  /** False when the project has no package.json. */
  applicable: boolean;
  runtime: number;
  dev: number;
  budget: DependencyBudget;
  over: string[];
}

export function parseBudget(raw: unknown): DependencyBudget {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d);
  return { runtime: n(r.runtime, DEFAULT_BUDGET.runtime), dev: n(r.dev, DEFAULT_BUDGET.dev) };
}

export function checkDependencies(root: string): DependencyReport {
  const read = (f: string): Record<string, any> | null => { try { return JSON.parse(fs.readFileSync(path.join(root, f), 'utf-8')); } catch { return null; } };
  const pkg = read('package.json');
  const budget = parseBudget(read('project.config.json')?.dependency_budget);
  if (!pkg) return { applicable: false, runtime: 0, dev: 0, budget, over: [] };
  const runtime = Object.keys(pkg.dependencies ?? {}).length;
  const dev = Object.keys(pkg.devDependencies ?? {}).length;
  const over: string[] = [];
  if (runtime > budget.runtime) over.push(`${runtime} runtime packages, budget ${budget.runtime}`);
  if (dev > budget.dev) over.push(`${dev} dev packages, budget ${budget.dev}`);
  return { applicable: true, runtime, dev, budget, over };
}
