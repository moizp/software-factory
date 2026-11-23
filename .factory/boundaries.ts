import * as fs from 'fs';
import * as path from 'path';
import { globToRegExp } from './policy-engine';

/**
 * Shared code is written in a framework-agnostic way: a core layer of plain TypeScript (domain logic, validation, state
 * machines, formatting, the API client) that imports no framework and, to keep imports few, nothing else outside the
 * project unless the project allows it by name. Components, routes, stores and server handlers are adapters that
 * import the core; the core never imports an adapter. This module only reads files and reports; it changes nothing.
 */

export interface Boundaries {
  /** Globs of the core layer, relative to the project root. */
  core: string[];
  /** Packages the core may import besides relative paths. Empty by default: the core imports nothing from outside. */
  allow: string[];
}

export const DEFAULT_CORE = ['src/lib/core/**'];

/** Frameworks and runtimes the core must never know about. Matched as the package name or any path under it. */
export const FRAMEWORKS = [
  'svelte', '@sveltejs', '$app', '$env', '$service-worker', 'react', 'react-dom', 'next', 'vue', 'nuxt', '@angular', 'solid-js', 'preact',
  'express', 'fastify', 'koa', 'hono', '@nestjs', '@prisma/client', 'drizzle-orm', 'axios'
];

export interface Violation {
  file: string;
  line: number;
  spec: string;
  kind: 'framework' | 'external' | 'adapter-file' | 'adapter-import';
  message: string;
}

export function parseBoundaries(raw: unknown): { ok: true; value: Boundaries } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: { core: [...DEFAULT_CORE], allow: [] } };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'boundaries must be an object: { "core": ["src/lib/core/**"], "allow": [] }' };
  const r = raw as Record<string, unknown>;
  const list = (v: unknown, name: string): string[] | string => {
    if (v === undefined) return [];
    return Array.isArray(v) && v.every(x => typeof x === 'string' && x.trim()) ? (v as string[]).map(x => x.trim()) : `boundaries.${name} must be a list of strings`;
  };
  const core = list(r.core, 'core');
  const allow = list(r.allow, 'allow');
  if (typeof core === 'string') return { ok: false, error: core };
  if (typeof allow === 'string') return { ok: false, error: allow };
  return { ok: true, value: { core: core.length ? core : [...DEFAULT_CORE], allow } };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.svelte-kit', '.next', 'coverage']);
const CODE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const ADAPTER_FILE = /\.(?:svelte|tsx|jsx|vue|astro)$/;
/** A test may import its test runner: only the code that ships is held to the core's rules. */
const TEST_FILE = /(?:\.(?:test|spec)\.[a-z]+$|(?:^|\/)__tests__\/)/;

function walk(root: string, dir = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...walk(root, path.join(dir, e.name))); }
    else out.push(path.join(dir, e.name).split(path.sep).join('/'));
  }
  return out;
}

/** Comments out of the way, so a package named in a comment is not an import. Strings are kept: specifiers are strings. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_m, p1) => p1);
}

const IMPORT = /(?:\bimport\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?|\bexport\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+)?from\s+|\brequire\(\s*|\bimport\(\s*)(['"])([^'"\n]+)\1/g;

export function importsOf(src: string): Array<{ spec: string; line: number }> {
  const clean = stripComments(src);
  const found: Array<{ spec: string; line: number }> = [];
  for (const m of clean.matchAll(IMPORT)) found.push({ spec: m[2], line: clean.slice(0, m.index).split('\n').length });
  return found;
}

const isRelative = (s: string): boolean => s.startsWith('./') || s.startsWith('../') || s === '.' || s === '..';
const packageOf = (s: string): string => (s.startsWith('@') || s.startsWith('$') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
const isFramework = (s: string): boolean => FRAMEWORKS.some(f => s === f || s.startsWith(`${f}/`));

/** What one core file's imports break. `allow` names packages the project accepts in its core. */
export function checkSource(file: string, src: string, b: Boundaries): Violation[] {
  const out: Violation[] = [];
  for (const { spec, line } of importsOf(src)) {
    if (isRelative(spec)) continue;
    if (spec === '$lib/core' || spec.startsWith('$lib/core/')) continue;
    if (spec.startsWith('$lib/') || spec === '$lib') {
      out.push({ file, line, spec, kind: 'adapter-import', message: `the core imports ${spec}, which is outside the core: the core never imports an adapter` });
      continue;
    }
    if (isFramework(spec)) {
      out.push({ file, line, spec, kind: 'framework', message: `the core imports the framework or runtime "${spec}": move that code to an adapter and pass what the core needs in as arguments` });
      continue;
    }
    const pkg = packageOf(spec.replace(/^node:/, 'node:'));
    if (b.allow.includes(pkg) || b.allow.includes(spec)) continue;
    out.push({ file, line, spec, kind: 'external', message: `the core imports "${spec}": write the small piece in-house, or name the package under boundaries.allow with the reason in the plan` });
  }
  return out;
}

export interface Report {
  files: number;
  violations: Violation[];
}

/** Every core file of the project at `root`, checked, except tests. Component files in the core are violations too. */
export function checkProject(root: string, b: Boundaries): Report {
  const matchers = b.core.map(globToRegExp);
  const files = walk(root).filter(f => matchers.some(m => m.test(f)) && !TEST_FILE.test(f));
  const violations: Violation[] = [];
  let scanned = 0;
  for (const f of files) {
    if (ADAPTER_FILE.test(f)) {
      violations.push({ file: f, line: 1, spec: path.basename(f), kind: 'adapter-file', message: 'a component file is in the core: components are adapters, move it out and keep only plain TypeScript here' });
      continue;
    }
    if (!CODE.test(f)) continue;
    scanned++;
    violations.push(...checkSource(f, fs.readFileSync(path.join(root, f), 'utf-8'), b));
  }
  return { files: scanned, violations };
}

export function renderReport(r: Report): string {
  if (r.violations.length === 0) return `${r.files} core file(s): no framework and no outside package imported`;
  return [`${r.violations.length} violation(s) in ${r.files} core file(s):`, ...r.violations.map(v => `${v.file}:${v.line}  ${v.message}`)].join('\n');
}
