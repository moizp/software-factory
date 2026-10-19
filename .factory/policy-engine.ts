import { execFileSync } from 'child_process';

/**
 * Repo-level merge policy (.factory/policy.json), always read from the BASE branch
 * so a PR cannot loosen its own rules. Strictest rule wins; anything unclear
 * fails closed to "a human merges".
 */

export interface PolicyRule {
  name?: string;
  match: {
    /** Branch name globs, e.g. ["fix/*"] */
    branch?: string[];
    /** Every changed file must match one of these globs */
    paths_only?: string[];
    /** At least one changed file matches one of these globs */
    paths_any?: string[];
    max_files?: number;
    max_lines?: number;
  };
  auto_merge?: boolean;
  /** Human approvals needed when the PR is not auto-merged */
  approvals?: number;
  /** Checks that must pass before merging: "ci", "reviewer_verdict" */
  require?: string[];
}

export interface Policy {
  version: 1;
  default: { auto_merge: boolean; approvals: number; require?: string[] };
  /** Changes touching these always need a human, whatever the rules say */
  protected_paths: string[];
  /** Labels that force a human (labels can only tighten, never loosen) */
  force_manual_labels?: string[];
  rules: PolicyRule[];
}

export interface PrInfo {
  branch: string;
  files: string[];
  changedLines: number;
  labels?: string[];
}

export interface Decision {
  autoMerge: boolean;
  approvals: number;
  require: string[];
  reasons: string[];
}

export const STRICT_POLICY: Policy = {
  version: 1,
  default: { auto_merge: false, approvals: 1, require: ['ci'] },
  protected_paths: [],
  rules: []
};

/** Glob to RegExp: ** crosses directories, * and ? do not cross "/". */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(value: string, globs: string[]): boolean {
  return globs.some(g => globToRegExp(g).test(value));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

/** Validates the raw JSON; throws with a precise message so bad policies are caught early. */
export function parsePolicy(raw: unknown): Policy {
  const fail = (msg: string): never => {
    throw new Error(`Invalid policy: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') fail('not an object');
  const p = raw as Record<string, any>;
  if (p.version !== 1) fail('version must be 1');
  const d = p.default;
  if (!d || typeof d.auto_merge !== 'boolean' || !Number.isInteger(d.approvals) || d.approvals < 0) {
    fail('default needs boolean auto_merge and integer approvals >= 0');
  }
  if (d.require !== undefined && !isStringArray(d.require)) fail('default.require must be string[]');
  if (!isStringArray(p.protected_paths)) fail('protected_paths must be string[]');
  if (p.force_manual_labels !== undefined && !isStringArray(p.force_manual_labels)) {
    fail('force_manual_labels must be string[]');
  }
  if (!Array.isArray(p.rules)) fail('rules must be an array');

  p.rules.forEach((r: any, i: number) => {
    const where = `rules[${i}]${r?.name ? ` (${r.name})` : ''}`;
    if (!r || typeof r.match !== 'object' || r.match === null) fail(`${where}: match is required`);
    for (const key of ['branch', 'paths_only', 'paths_any']) {
      if (r.match[key] !== undefined && !isStringArray(r.match[key])) fail(`${where}: match.${key} must be string[]`);
    }
    for (const key of ['max_files', 'max_lines']) {
      if (r.match[key] !== undefined && !(Number.isInteger(r.match[key]) && r.match[key] >= 0)) {
        fail(`${where}: match.${key} must be an integer >= 0`);
      }
    }
    if (Object.keys(r.match).length === 0) fail(`${where}: match must have at least one condition`);
    if (r.auto_merge !== undefined && typeof r.auto_merge !== 'boolean') fail(`${where}: auto_merge must be boolean`);
    if (r.approvals !== undefined && !(Number.isInteger(r.approvals) && r.approvals >= 0)) {
      fail(`${where}: approvals must be an integer >= 0`);
    }
    if (r.require !== undefined && !isStringArray(r.require)) fail(`${where}: require must be string[]`);
  });

  return p as unknown as Policy;
}

function ruleMatches(rule: PolicyRule, pr: PrInfo): boolean {
  const m = rule.match;
  if (m.branch && !matchesAny(pr.branch, m.branch)) return false;
  if (m.paths_only && !(pr.files.length > 0 && pr.files.every(f => matchesAny(f, m.paths_only!)))) return false;
  if (m.paths_any && !pr.files.some(f => matchesAny(f, m.paths_any!))) return false;
  if (m.max_files !== undefined && pr.files.length > m.max_files) return false;
  if (m.max_lines !== undefined && pr.changedLines > m.max_lines) return false;
  return true;
}

export function evaluatePolicy(policy: Policy, pr: PrInfo): Decision {
  const reasons: string[] = [];
  let forceManual = false;

  if (pr.files.length === 0) {
    forceManual = true;
    reasons.push('no changed files detected (failing closed)');
  }

  const touched = pr.files.filter(f => matchesAny(f, policy.protected_paths));
  if (touched.length > 0) {
    forceManual = true;
    reasons.push(`protected paths changed: ${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', ...' : ''}`);
  }

  const forcedBy = (pr.labels ?? []).filter(l => (policy.force_manual_labels ?? []).includes(l));
  if (forcedBy.length > 0) {
    forceManual = true;
    reasons.push(`label forces human review: ${forcedBy.join(', ')}`);
  }

  const matched = policy.rules.filter(r => ruleMatches(r, pr));
  for (const r of matched) {
    if (r.auto_merge === false) {
      forceManual = true;
      reasons.push(`rule "${r.name ?? 'unnamed'}" requires a human`);
    }
  }

  const allowedBy = matched.filter(r => r.auto_merge === true);
  const autoMerge = !forceManual && (allowedBy.length > 0 || policy.default.auto_merge);

  if (autoMerge && allowedBy.length > 0) {
    reasons.push(`auto-merge allowed by: ${allowedBy.map(r => r.name ?? 'unnamed').join(', ')}`);
  } else if (autoMerge) {
    reasons.push('auto-merge allowed by the default: nothing protected changed');
  } else if (reasons.length === 0) {
    reasons.push('no rule allows auto-merge (default is a human merges)');
  }

  const approvals = autoMerge
    ? 0
    : Math.max(policy.default.approvals, ...matched.map(r => r.approvals ?? 0));
  const require = Array.from(new Set([...(policy.default.require ?? []), ...matched.flatMap(r => r.require ?? [])]));

  return { autoMerge, approvals, require, reasons };
}

/** Reads and validates the policy as committed on `ref` (use the base branch). Fails closed. */
export function loadPolicy(ref: string, cwd: string = process.cwd()): Policy {
  try {
    const raw = execFileSync('git', ['show', `${ref}:.factory/policy.json`], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return parsePolicy(JSON.parse(raw));
  } catch {
    return STRICT_POLICY;
  }
}

/** Changed files and line count between base and head (renames count as delete + add). */
export function prInfoFromGit(
  base: string,
  head: string,
  branch: string,
  labels: string[] = [],
  cwd: string = process.cwd()
): PrInfo {
  const out = execFileSync('git', ['diff', '--numstat', '--no-renames', `${base}...${head}`], {
    cwd,
    encoding: 'utf-8'
  });
  const files: string[] = [];
  let changedLines = 0;
  for (const line of out.split('\n').filter(Boolean)) {
    const [added, removed, ...rest] = line.split('\t');
    files.push(rest.join('\t'));
    changedLines += (parseInt(added, 10) || 0) + (parseInt(removed, 10) || 0);
  }
  return { branch, files, changedLines, labels };
}
