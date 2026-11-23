#!/usr/bin/env node
'use strict';
/**
 * Keeps the CSS from growing without limit. It reads the CSS people write (src/**.css and the <style> blocks of
 * .svelte files, not what Tailwind generates) and fails when it is over its budget, when one component carries a long
 * <style> block, when the same declarations are written twice, or when @apply is used a lot. Built CSS, when a build
 * exists, has a gzip budget too. No dependencies: it runs anywhere Node does.
 *
 * Usage: node scripts/css-budget.cjs [--root <dir>] [--json]
 * Budgets live in project.config.json under "css_budget" (these are the defaults). Never raise a number to get a check
 * through: write the style with Tailwind utilities or a shared component instead, or ask a person.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULTS = { authored_kb: 20, svelte_style_lines: 30, built_gzip_kb: 50, duplicate_min_declarations: 3, apply_max: 10 };
const SKIP = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'dist', 'coverage']);

function walk(root, dir = '') {
	const out = [];
	for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
		if (e.isDirectory()) { if (!SKIP.has(e.name)) out.push(...walk(root, path.join(dir, e.name))); }
		else out.push(path.join(dir, e.name).split(path.sep).join('/'));
	}
	return out;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const lines = (text) => text.split('\n').filter((l) => l.trim()).length;

/** The authored CSS of a project: one entry per .css file and per <style> block, with where it came from. */
function authoredCss(root) {
	const pieces = [];
	let sources = [];
	try { sources = walk(root, 'src'); } catch { return pieces; }
	for (const f of sources) {
		const text = fs.readFileSync(path.join(root, f), 'utf-8');
		if (f.endsWith('.css')) pieces.push({ file: f, css: stripComments(text), kind: 'css' });
		else if (f.endsWith('.svelte')) {
			for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) pieces.push({ file: f, css: stripComments(m[1]), kind: 'style' });
		}
	}
	return pieces;
}

/** Rules that repeat the same set of declarations (at least `min` of them), which should be one utility or one component. */
function duplicateRules(pieces, min) {
	const seen = new Map();
	for (const p of pieces) {
		for (const m of p.css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
			const decls = m[2].split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();
			if (decls.length < min) continue;
			const key = decls.join(';');
			seen.set(key, [...(seen.get(key) || []), `${m[1].trim()} (${p.file})`]);
		}
	}
	return [...seen.values()].filter((v) => v.length > 1);
}

function builtGzipBytes(root) {
	const dirs = ['.svelte-kit/output/client/_app/immutable/assets', 'build'];
	let total = 0, found = false;
	for (const d of dirs) {
		const abs = path.join(root, d);
		if (!fs.existsSync(abs)) continue;
		for (const f of walk(abs)) if (f.endsWith('.css')) { found = true; total += zlib.gzipSync(fs.readFileSync(path.join(abs, f))).length; }
		if (found) break;
	}
	return found ? total : null;
}

function check(root, config = {}) {
	const budget = { ...DEFAULTS, ...config };
	const pieces = authoredCss(root);
	const violations = [];
	const bytes = pieces.reduce((n, p) => n + Buffer.byteLength(p.css), 0);
	if (bytes > budget.authored_kb * 1024) {
		violations.push({ kind: 'authored-size', message: `${(bytes / 1024).toFixed(1)} KB of hand-written CSS, budget ${budget.authored_kb} KB: use Tailwind utilities in the markup, or one shared component, instead of new rules` });
	}
	for (const p of pieces) {
		if (p.kind === 'style' && lines(p.css) > budget.svelte_style_lines) {
			violations.push({ kind: 'style-block', file: p.file, message: `${lines(p.css)} lines in one <style> block, limit ${budget.svelte_style_lines}: move it to utilities, or split the component` });
		}
	}
	for (const group of duplicateRules(pieces, budget.duplicate_min_declarations)) {
		violations.push({ kind: 'duplicate', message: `the same ${budget.duplicate_min_declarations}+ declarations are written ${group.length} times (${group.slice(0, 3).join('; ')}): make one component or utility` });
	}
	const applies = pieces.reduce((n, p) => n + (p.css.match(/@apply\b/g) || []).length, 0);
	if (applies > budget.apply_max) violations.push({ kind: 'apply', message: `@apply is used ${applies} times, limit ${budget.apply_max}: a repeated set of utilities belongs in a Svelte component, not a CSS class` });
	const built = builtGzipBytes(root);
	if (built !== null && built > budget.built_gzip_kb * 1024) {
		violations.push({ kind: 'built-size', message: `built CSS is ${(built / 1024).toFixed(1)} KB gzipped, budget ${budget.built_gzip_kb} KB: look for unused rules and safelisted classes` });
	}
	return { authoredBytes: bytes, pieces: pieces.length, builtGzipBytes: built, budget, violations };
}

function render(r) {
	const head = `${(r.authoredBytes / 1024).toFixed(1)} KB hand-written CSS in ${r.pieces} place(s), budget ${r.budget.authored_kb} KB; built CSS ${r.builtGzipBytes === null ? 'not built yet' : `${(r.builtGzipBytes / 1024).toFixed(1)} KB gzipped`}`;
	return r.violations.length ? [`${r.violations.length} problem(s). ${head}`, ...r.violations.map((v) => `- ${v.file ? `${v.file}: ` : ''}${v.message}`)].join('\n') : `ok. ${head}`;
}

function main() {
	const args = process.argv.slice(2);
	const at = args.indexOf('--root');
	const root = path.resolve(at >= 0 ? args[at + 1] : process.cwd());
	let config = {};
	try { config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf-8')).css_budget || {}; } catch { /* defaults */ }
	const r = check(root, config);
	console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
	process.exit(r.violations.length ? 1 : 0);
}

module.exports = { check, render, DEFAULTS };
if (require.main === module) main();
