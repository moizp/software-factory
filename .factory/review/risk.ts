import { Policy, globToRegExp } from '../policy-engine';
import { Tier } from './types';

export interface RiskInput {
  files: string[];
  changedLines: number;
}

export interface Risk {
  tier: Tier;
  reasons: string[];
}

const DOC_OR_TEST = [
  '**/*.md', 'docs/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/tests/**', 'LICENSE', '.gitignore'
];
const DEPENDENCY_FILES = [
  'package.json', '**/package.json', 'package-lock.json', '**/package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements*.txt', '**/requirements*.txt', 'pyproject.toml', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile'
];
const SENSITIVE = [
  '**/auth/**', '**/*auth*.*', '**/*authz*.*', '**/*permission*.*', '**/*payment*.*', '**/*billing*.*', '**/*secret*.*',
  '**/migrations/**', '**/*.sql', '**/schema.prisma', '**/Dockerfile', '**/docker-compose*.yml', '**/*.tf',
  '.github/**', 'contracts/**', '**/openapi*.*'
];

const R1_MAX_FILES = 8;
const R1_MAX_LINES = 200;
const R3_MIN_FILES = 25;
const R3_MIN_LINES = 600;

function matching(files: string[], globs: string[]): string[] {
  const res = globs.map(globToRegExp);
  return files.filter(f => res.some(re => re.test(f)));
}

/**
 * Deterministic risk tier. Higher tiers win, and an unknown shape never lowers the tier.
 * The writer's own risk claim in the PR body is ignored here; it is only a claim to check.
 */
export function classifyRisk(policy: Policy, input: RiskInput): Risk {
  const { files, changedLines } = input;
  if (files.length === 0) {
    return { tier: 'R0', reasons: ['no changed files'] };
  }

  const r3: string[] = [];
  const protectedHits = matching(files, policy.protected_paths);
  if (protectedHits.length) r3.push(`protected paths: ${protectedHits.slice(0, 3).join(', ')}`);
  const sensitiveHits = matching(files, SENSITIVE);
  if (sensitiveHits.length) r3.push(`sensitive area: ${sensitiveHits.slice(0, 3).join(', ')}`);
  if (files.length >= R3_MIN_FILES) r3.push(`${files.length} files changed`);
  if (changedLines >= R3_MIN_LINES) r3.push(`${changedLines} lines changed`);
  if (r3.length) return { tier: 'R3', reasons: r3 };

  const nonDocs = files.filter(f => !matching([f], DOC_OR_TEST).length);
  if (nonDocs.length === 0) return { tier: 'R0', reasons: ['docs and tests only'] };

  const r2: string[] = [];
  const deps = matching(files, DEPENDENCY_FILES);
  if (deps.length) r2.push(`dependency files: ${deps.slice(0, 3).join(', ')}`);
  if (files.length > R1_MAX_FILES) r2.push(`${files.length} files changed`);
  if (changedLines > R1_MAX_LINES) r2.push(`${changedLines} lines changed`);
  const areas = new Set(nonDocs.map(f => f.split('/')[0]));
  if (areas.size > 2) r2.push(`spans ${areas.size} top-level areas`);
  if (r2.length) return { tier: 'R2', reasons: r2 };

  return { tier: 'R1', reasons: ['small local change'] };
}
