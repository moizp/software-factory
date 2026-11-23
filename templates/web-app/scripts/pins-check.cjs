#!/usr/bin/env node
'use strict';
/**
 * Dependabot keeps package.json and the workflows current. It does not see versions pinned in other files, such as the
 * MCP servers started with `npx pkg@1.2.3` in .mcp.json. This finds those pins and says which are behind the latest
 * release. No dependencies: it asks `npm view`, so it needs network and npm.
 *
 * Usage: node scripts/pins-check.cjs [--json] [file ...]   (default: .mcp.json project.config.json)
 * Exit 1 when a pin is behind, so a scheduled job can open an issue.
 */
const fs = require('fs');
const { spawnSync } = require('child_process');

const PIN = /^((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+(?:-[\w.]+)?)$/;

/** Every `pkg@x.y.z` argument of an MCP server entry in the given JSON files. */
function findPins(files, read = (f) => fs.readFileSync(f, 'utf-8')) {
	const pins = [];
	for (const file of files) {
		let json;
		try { json = JSON.parse(read(file)); } catch { continue; }
		const servers = json.mcpServers || json.mcp_servers || {};
		for (const [name, s] of Object.entries(servers)) {
			for (const arg of (s && s.args) || []) {
				const m = PIN.exec(String(arg));
				if (m) pins.push({ file, server: name, pkg: m[1], pinned: m[2] });
			}
		}
	}
	return pins;
}

const newer = (a, b) => {
	const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
	for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
	return false;
};

function latestFromNpm(pkg) {
	const r = spawnSync('npm', ['view', pkg, 'version'], { encoding: 'utf-8', timeout: 60000 });
	return r.status === 0 ? r.stdout.trim() : null;
}

function check(files, latest = latestFromNpm, read) {
	const rows = findPins(files, read).map((p) => {
		const l = latest(p.pkg);
		return { ...p, latest: l, behind: l !== null && newer(l, p.pinned), unknown: l === null };
	});
	return { rows, behind: rows.filter((r) => r.behind), unknown: rows.filter((r) => r.unknown) };
}

function render(r) {
	if (r.rows.length === 0) return 'no pinned MCP packages found';
	const lines = r.rows.map((x) => `${x.pkg}: pinned ${x.pinned}, latest ${x.latest ?? 'unknown'}${x.behind ? '  <- behind' : ''} (${x.server} in ${x.file})`);
	return [r.behind.length ? `${r.behind.length} pin(s) behind:` : 'all pins are current', ...lines].join('\n');
}

function main() {
	const args = process.argv.slice(2);
	const files = args.filter((a) => !a.startsWith('--'));
	const r = check(files.length ? files : ['.mcp.json', 'project.config.json']);
	console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : render(r));
	process.exit(r.behind.length ? 1 : 0);
}

module.exports = { findPins, check, render, newer };
if (require.main === module) main();
