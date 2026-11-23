#!/usr/bin/env node
'use strict';
/**
 * Versioning for a project released with the release-candidate flow. No dependencies: it runs anywhere Node and git do.
 *
 *   node scripts/version.cjs next  [--since vX.Y.Z] [--json]       what the commits since the last tag call for
 *   node scripts/version.cjs bump  [--version X.Y.Z] [--since vX.Y.Z] [--date YYYY-MM-DD]
 *                                                                 write the version into package.json AND package-lock.json,
 *                                                                 and a section into CHANGELOG.md
 *   node scripts/version.cjs check [--version X.Y.Z]               package.json, package-lock.json (and the changelog) agree
 *   node scripts/version.cjs notes --version X.Y.Z                 the changelog section, for release notes
 *
 * The next version comes from the conventional commits since the last tag (`vX.Y.Z`):
 *   a breaking change (`type!:` or a `BREAKING CHANGE:` line) -> major,  `feat` -> minor,  `fix` or `perf` -> patch.
 * Before 1.0.0 a breaking change bumps the minor and a feature the patch. Only docs, chore, test, ci, style, build and
 * refactor commits mean there is nothing to release; pass --version to release anyway.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG = /^v(\d+\.\d+\.\d+)$/;
const COMMIT = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const HEADER = '# Changelog\n\nAll notable changes to this project. Versions follow [semantic versioning](https://semver.org); each section is written by `version.cjs bump` from the conventional commits since the previous release.\n\n';

const parse = (v) => { const m = SEMVER.exec(v); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };

function increase(version, kind) {
	const [a, b, c] = parse(version);
	if (kind === 'major') return `${a + 1}.0.0`;
	if (kind === 'minor') return `${a}.${b + 1}.0`;
	return `${a}.${b}.${c + 1}`;
}

/** Splits a commit into its type, scope, text and whether it breaks compatibility. Null when it is not conventional. */
function parseCommit(subject, body = '') {
	const m = COMMIT.exec(subject.trim());
	if (!m) return null;
	return { type: m[1].toLowerCase(), scope: m[2] || '', breaking: !!m[3] || /^BREAKING[ -]CHANGE:/m.test(body), text: m[4].trim() };
}

/** The bump the commits call for, and the changelog groups. `commits` are { hash, subject, body }. */
function classify(commits, current) {
	const groups = { breaking: [], feat: [], fix: [], perf: [] };
	const unknown = [];
	for (const c of commits) {
		const p = parseCommit(c.subject, c.body);
		if (!p) { unknown.push(c); continue; }
		const entry = { hash: c.hash.slice(0, 7), scope: p.scope, text: p.text };
		if (p.breaking) groups.breaking.push(entry);
		if (p.type === 'feat') groups.feat.push(entry);
		else if (p.type === 'fix') groups.fix.push(entry);
		else if (p.type === 'perf') groups.perf.push(entry);
	}
	const preOne = parse(current)[0] === 0;
	let bump = 'none';
	if (groups.fix.length || groups.perf.length) bump = 'patch';
	if (groups.feat.length) bump = preOne ? 'patch' : 'minor';
	if (groups.breaking.length) bump = preOne ? 'minor' : 'major';
	return { bump, groups, unknown };
}

function git(root, args) {
	const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
	return r.status === 0 ? r.stdout : null;
}

/** The newest vX.Y.Z tag reachable from `until`, or null when nothing was ever released. */
function lastTag(root, until = 'HEAD') {
	const out = git(root, ['tag', '--list', 'v[0-9]*', '--merged', until, '--sort=-v:refname']);
	return (out || '').split('\n').find((t) => TAG.test(t)) || null;
}

function commitsSince(root, tag, until = 'HEAD') {
	const out = git(root, ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', tag ? `${tag}..${until}` : until]) || '';
	return out.split('\x1e').map((s) => s.replace(/^\n+/, '')).filter(Boolean).map((s) => { const [hash, subject, body] = s.split('\x1f'); return { hash, subject, body: body || '' }; });
}

function readJson(file) {
	const text = fs.readFileSync(file, 'utf-8');
	const indent = /^(\s+)"/m.exec(text);
	return { json: JSON.parse(text), indent: indent ? indent[1] : '  ', newline: text.endsWith('\n') };
}

const currentVersion = (root) => readJson(path.join(root, 'package.json')).json.version;

/** What the commits since the last tag call for. With no tag yet the project's own version is the first release. */
function next(root, opts = {}) {
	const tag = opts.since || lastTag(root);
	const current = tag ? TAG.exec(tag)[1] : currentVersion(root);
	if (!tag) {
		// The first release lists everything done so far
		const all = classify(commitsSince(root, null), current);
		return { first: true, lastTag: null, current, bump: 'first', next: current, groups: all.groups, unknown: all.unknown.map((u) => u.subject) };
	}
	const c = classify(commitsSince(root, tag), current);
	return { first: false, lastTag: tag, current, bump: c.bump, next: c.bump === 'none' ? null : increase(current, c.bump), groups: c.groups, unknown: c.unknown.map((u) => u.subject) };
}

/** Writes the version into package.json and package-lock.json (both fields npm keeps in the lock file). */
function writeVersion(root, version) {
	if (!parse(version)) throw new Error(`"${version}" is not a version like 1.4.0`);
	const written = [];
	for (const name of ['package.json', 'package-lock.json']) {
		const file = path.join(root, name);
		if (!fs.existsSync(file)) continue;
		const { json, indent, newline } = readJson(file);
		json.version = version;
		if (name === 'package-lock.json' && json.packages && json.packages['']) json.packages[''].version = version;
		fs.writeFileSync(file, JSON.stringify(json, null, indent) + (newline ? '\n' : ''));
		written.push(name);
	}
	return written;
}

function section(version, date, groups) {
	const part = (title, items) => (items.length ? [`### ${title}`, ...items.map((i) => `- ${i.scope ? `**${i.scope}:** ` : ''}${i.text} (${i.hash})`), ''] : []);
	const lines = [`## [${version}] - ${date}`, '', ...part('Breaking changes', groups.breaking), ...part('Features', groups.feat), ...part('Fixes', groups.fix), ...part('Performance', groups.perf)];
	if (lines.length === 2) lines.push('Maintenance only.', '');
	return lines.join('\n');
}

function addToChangelog(existing, sectionText, version) {
	if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(existing || '')) throw new Error(`CHANGELOG.md already has a section for ${version}`);
	const base = existing && existing.trim() ? existing : HEADER;
	const at = base.search(/^## \[/m);
	return at < 0 ? `${base.replace(/\n*$/, '\n\n')}${sectionText}\n` : `${base.slice(0, at)}${sectionText}\n${base.slice(at)}`;
}

function bump(root, opts = {}) {
	const plan = next(root, opts);
	const version = opts.version || plan.next;
	if (!version) throw new Error(`nothing to release since ${plan.lastTag}: only docs, chores, tests or refactors. Pass --version X.Y.Z to release anyway.`);
	const files = writeVersion(root, version);
	const date = opts.date || new Date().toISOString().slice(0, 10);
	const file = path.join(root, 'CHANGELOG.md');
	const text = addToChangelog(fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '', section(version, date, plan.groups), version);
	fs.writeFileSync(file, text);
	return { version, files: [...files, 'CHANGELOG.md'], plan };
}

/** Everything wrong with the version files. Empty when package.json, the lock file and (with `version`) the changelog agree. */
function check(root, opts = {}) {
	const problems = [];
	const pkgFile = path.join(root, 'package.json');
	if (!fs.existsSync(pkgFile)) return ['no package.json'];
	const pkg = readJson(pkgFile).json.version;
	if (!parse(String(pkg))) problems.push(`package.json version "${pkg}" is not X.Y.Z`);
	const lockFile = path.join(root, 'package-lock.json');
	if (fs.existsSync(lockFile)) {
		const lock = readJson(lockFile).json;
		if (lock.version !== pkg) problems.push(`package-lock.json says ${lock.version}, package.json says ${pkg}`);
		const inner = lock.packages && lock.packages[''] ? lock.packages[''].version : undefined;
		if (inner !== undefined && inner !== pkg) problems.push(`package-lock.json packages[""] says ${inner}, package.json says ${pkg}`);
	}
	if (opts.version) {
		if (pkg !== opts.version) problems.push(`package.json says ${pkg}, the release is ${opts.version}`);
		const log = fs.existsSync(path.join(root, 'CHANGELOG.md')) ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8') : '';
		if (!new RegExp(`^## \\[${opts.version.replace(/\./g, '\\.')}\\]`, 'm').test(log)) problems.push(`CHANGELOG.md has no section for ${opts.version}`);
	}
	return problems;
}

function notes(root, version) {
	const file = path.join(root, 'CHANGELOG.md');
	const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
	const start = text.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
	if (start < 0) return null;
	const rest = text.slice(start).split('\n');
	const end = rest.findIndex((l, i) => i > 0 && /^## \[/.test(l));
	return rest.slice(1, end < 0 ? undefined : end).join('\n').trim();
}

function renderNext(p) {
	if (p.first) return `no release yet: the first one is ${p.next} (the version in package.json)`;
	const n = (k) => p.groups[k].length;
	const counts = `${n('breaking')} breaking, ${n('feat')} feature(s), ${n('fix')} fix(es), ${n('perf')} performance`;
	const head = p.next ? `${p.lastTag} -> ${p.next} (${p.bump}): ${counts}` : `${p.lastTag}: nothing to release (${counts})`;
	return p.unknown.length ? `${head}\nnot conventional, ignored: ${p.unknown.join('; ')}` : head;
}

function main() {
	const [cmd, ...args] = process.argv.slice(2);
	const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
	const root = process.cwd();
	const opts = { version: value('--version'), since: value('--since'), date: value('--date') };
	if (opts.version && !parse(opts.version)) { console.error(`--version must look like 1.4.0, not "${opts.version}"`); process.exit(2); }
	try {
		if (cmd === 'next') {
			const p = next(root, opts);
			console.log(args.includes('--json') ? JSON.stringify(p, null, 2) : renderNext(p));
			process.exit(p.next || p.first ? 0 : 3);
		} else if (cmd === 'bump') {
			const r = bump(root, opts);
			console.log(`version ${r.version} written to ${r.files.join(', ')}`);
		} else if (cmd === 'check') {
			const problems = check(root, opts);
			console.log(problems.length ? problems.map((p) => `- ${p}`).join('\n') : 'version files agree');
			process.exit(problems.length ? 1 : 0);
		} else if (cmd === 'notes') {
			if (!opts.version) { console.error('notes needs --version X.Y.Z'); process.exit(2); }
			const text = notes(root, opts.version);
			if (text === null) { console.error(`CHANGELOG.md has no section for ${opts.version}`); process.exit(1); }
			console.log(text);
		} else {
			console.error('Usage: version.cjs next | bump | check | notes  [--version X.Y.Z] [--since vX.Y.Z] [--date YYYY-MM-DD] [--json]');
			process.exit(2);
		}
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}

module.exports = { parseCommit, classify, increase, lastTag, commitsSince, next, writeVersion, section, addToChangelog, bump, check, notes, renderNext };
if (require.main === module) main();
