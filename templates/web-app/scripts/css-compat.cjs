#!/usr/bin/env node
'use strict';
/**
 * Compatibility gate. Before CSS that needs a newer browser is accepted, this checks the project's browser targets
 * (`browser_targets` in project.config.json, set by the owner; never assumed), and requires a fallback that a test can
 * lose. No dependencies.
 *
 *   node scripts/css-compat.cjs [--json]
 *
 * browser_targets is the oldest version the app must work in: { "chrome": 100, "safari": 15, "firefox": 100, "ios_saf": 15 }.
 * A feature the target lacks needs, in the same file:
 *   compat-fallback: <feature-id> | <snippet of the fallback> | <path of the test>
 * The snippet must still be in the file, and the test must exist and mention `compat:<feature-id>`; delete the fallback
 * and this check fails, and so does the test that mentions it.
 */
const fs = require('fs');
const path = require('path');

/** Oldest version that supports each feature. From caniuse-lite data (tests compare this table with it). */
const FEATURES = [
	{ id: 'container-queries', name: 'container queries', caniuse: 'css-container-queries', min: { chrome: 106, safari: 16.0, firefox: 110, ios_saf: 16.0 }, uses: [/@container\b/, /\bcontainer-type\s*:/, /(^|[\s"'`])@(?:xs|sm|md|lg|xl|2xl|3xl|\[[^\]]+\])[:/]/] },
	{ id: 'container-query-units', name: 'container query units', caniuse: 'css-container-query-units', min: { chrome: 105, safari: 16.0, firefox: 110, ios_saf: 16.0 }, uses: [/\b\d*\.?\d+(?:cqw|cqh|cqi|cqb|cqmin|cqmax)\b/] },
	{ id: 'has', name: ':has()', caniuse: 'css-has', min: { chrome: 105, safari: 15.4, firefox: 121, ios_saf: 15.4 }, uses: [/:has\(/, /(?:^|[\s"'`:])has-\[/] },
	{ id: 'viewport-unit-variants', name: 'dvh, svh and lvh units', caniuse: 'viewport-unit-variants', min: { chrome: 108, safari: 15.4, firefox: 101, ios_saf: 15.4 }, uses: [/\b\d*\.?\d+(?:dvh|svh|lvh|dvw|svw|lvw)\b/, /\b(?:min-|max-)?[hw]-(?:dvh|svh|lvh|dvw|svw|lvw)\b/] },
	{ id: 'flexbox-gap', name: 'gap in flex layouts', caniuse: 'flexbox-gap', min: { chrome: 84, safari: 14.1, firefox: 63, ios_saf: 14.5 }, uses: [/class="[^"]*\bflex\b[^"]*\bgap-/, /class="[^"]*\bgap-[^"]*\bflex\b/] },
	{ id: 'cascade-layers', name: '@layer', caniuse: 'css-cascade-layers', min: { chrome: 99, safari: 15.4, firefox: 97, ios_saf: 15.4 }, uses: [/@layer\b/] },
	{ id: 'text-wrap-balance', name: 'text-wrap: balance', caniuse: 'css-text-wrap-balance', min: { chrome: 130, safari: 17.5, firefox: 121, ios_saf: 17.5 }, uses: [/\btext-wrap\s*:\s*balance/, /(?:^|[\s"'`])text-balance\b/] },
	{ id: 'subgrid', name: 'subgrid', caniuse: 'css-subgrid', min: { chrome: 117, safari: 16.0, firefox: 71, ios_saf: 16.0 }, uses: [/\bsubgrid\b/] },
	{ id: 'focus-visible', name: ':focus-visible', caniuse: 'css-focus-visible', min: { chrome: 86, safari: 15.4, firefox: 4, ios_saf: 15.4 }, uses: [/:focus-visible\b/, /(?:^|[\s"'`:])focus-visible:/] },
	{ id: 'logical-props', name: 'logical properties (ps-, me-, margin-inline ...)', caniuse: 'css-logical-props', min: { chrome: 89, safari: 15, firefox: 66, ios_saf: 15 }, uses: [/\b(?:margin|padding)-(?:inline|block)(?:-start|-end)?\s*:/, /(?:^|[\s"'`])-?(?:ms|me|ps|pe)-(?:\d|\[|px\b)/] },
	{ id: 'lch-lab', name: 'oklch(), lab() and lch() colours', caniuse: 'css-lch-lab', min: { chrome: 111, safari: 15, firefox: 113, ios_saf: 15 }, uses: [/\b(?:oklch|oklab|lch|lab)\(/] }
];

/** Tailwind v4 needs Chrome 111, Safari 16.4 and Firefox 128 (tailwindcss.com/docs/compatibility). */
const TAILWIND_V4 = { chrome: 111, safari: 16.4, firefox: 128, ios_saf: 16.4 };

const SCAN = /\.(css|svelte|html|ts|js)$/;
const SKIP_DIR = new Set(['node_modules', '.svelte-kit', 'build', 'dist', 'coverage', '.git']);
const SKIP_FILE = /\.(test|spec)\.[tj]s$|\.d\.ts$/;

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), out); }
		else if (SCAN.test(e.name) && !SKIP_FILE.test(e.name)) out.push(path.join(dir, e.name));
	}
	return out;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; } };

/** The browsers a feature is missing in, given the targets: [{ browser, target, needs }]. */
function lacking(feature, targets) {
	return Object.entries(targets).filter(([b, v]) => feature.min[b] !== undefined && Number(v) < feature.min[b]).map(([browser, target]) => ({ browser, target: Number(target), needs: feature.min[browser] }));
}

const DECLARATION = /compat-fallback:\s*([\w-]+)\s*\|\s*([^|]+?)\s*\|\s*([^\s*>-][^\s*>]*?)\s*(?:\*\/|-->|$)/;

function check(root, opts = {}) {
	const violations = [];
	const add = (kind, message, file, line) => violations.push({ kind, message, file, line });
	const cfg = readJson(path.join(root, 'project.config.json')) || {};
	const targets = opts.targets || cfg.browser_targets;
	if (!targets || typeof targets !== 'object' || Object.keys(targets).length === 0) {
		add('targets-missing', 'project.config.json has no "browser_targets" (the oldest version of each browser the app must work in, e.g. {"chrome": 100, "safari": 15, "firefox": 100, "ios_saf": 15}). Ask the owner; this check does not guess them');
		return { violations, targets: null };
	}
	for (const b of Object.keys(targets)) if (!(b in TAILWIND_V4)) add('targets-unknown', `browser_targets names "${b}", which is not one of ${Object.keys(TAILWIND_V4).join(', ')}`);

	const pkg = readJson(path.join(root, 'package.json')) || {};
	const tw = (pkg.devDependencies || {}).tailwindcss || (pkg.dependencies || {}).tailwindcss;
	if (tw && /^[\^~]?4/.test(tw)) {
		const short = lacking({ min: TAILWIND_V4 }, targets);
		if (short.length) add('tailwind-version', `tailwindcss ${tw} needs ${short.map(s => `${s.browser} ${s.needs}`).join(', ')} but the targets are ${short.map(s => `${s.browser} ${s.target}`).join(', ')}. Use Tailwind 3.4 for older browsers, or the owner raises the targets`, 'package.json');
	}

	for (const file of walk(path.join(root, 'src'))) {
		const rel = path.relative(root, file);
		const lines = fs.readFileSync(file, 'utf-8').split('\n');
		const text = lines.join('\n');
		const declared = new Map();
		lines.forEach((l, i) => { const m = DECLARATION.exec(l); if (m) declared.set(m[1], { snippet: m[2], test: m[3], line: i + 1 }); });
		for (const f of FEATURES) {
			const miss = lacking(f, targets);
			if (!miss.length) continue;
			const at = lines.findIndex(l => !DECLARATION.test(l) && f.uses.some(r => r.test(l)));
			if (at < 0) continue;
			const where = `${f.name} needs ${miss.map(m => `${m.browser} ${m.needs}`).join(', ')}; the targets are ${miss.map(m => `${m.browser} ${m.target}`).join(', ')}`;
			const d = declared.get(f.id);
			if (!d) { add('no-fallback', `${where}. Use a plain Tailwind alternative, or add "compat-fallback: ${f.id} | <fallback snippet> | <test path>" and the fallback`, rel, at + 1); continue; }
			const body = lines.filter(l => !DECLARATION.test(l)).join('\n');
			if (!body.includes(d.snippet)) add('fallback-missing', `${where}. The declared fallback "${d.snippet}" is not in this file any more`, rel, d.line);
			const testFile = path.join(root, d.test);
			if (!fs.existsSync(testFile)) add('fallback-untested', `${where}. The declared test ${d.test} does not exist`, rel, d.line);
			else if (!fs.readFileSync(testFile, 'utf-8').includes(`compat:${f.id}`)) add('fallback-untested', `${where}. ${d.test} does not mention "compat:${f.id}", so nothing there fails when the fallback goes`, rel, d.line);
		}
		void text;
	}
	return { violations, targets };
}

module.exports = { FEATURES, TAILWIND_V4, check, lacking };

if (require.main === module) {
	const { violations, targets } = check(process.cwd());
	if (process.argv.includes('--json')) console.log(JSON.stringify({ targets, violations }, null, 2));
	else if (violations.length) {
		console.error(`compat check: ${violations.length} problem(s)`);
		for (const v of violations) console.error(`  ${v.kind}${v.file ? `  ${v.file}${v.line ? ':' + v.line : ''}` : ''}  ${v.message}`);
	} else console.log(`compat check: pass (targets ${Object.entries(targets).map(([b, v]) => `${b} ${v}`).join(', ')})`);
	process.exit(violations.length ? 1 : 0);
}
