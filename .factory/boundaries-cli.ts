#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { checkProject, parseBoundaries, renderReport } from './boundaries';

// Usage: boundaries-cli [--json]   check that the project's core layer imports no framework (exit 1 on violations)
// Configure in project.config.json: "boundaries": { "core": ["src/lib/core/**"], "allow": [] } (these are the defaults)
const root = process.cwd();
let config: Record<string, unknown> = {};
const file = path.join(root, 'project.config.json');
if (fs.existsSync(file)) {
  try { config = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { console.error('project.config.json is not valid JSON'); process.exit(2); }
}
const b = parseBoundaries(config.boundaries);
if (!b.ok) { console.error(b.error); process.exit(2); }
const report = checkProject(root, b.value);
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else console.log(report.files === 0 && report.violations.length === 0 ? `No core files match ${b.value.core.join(', ')}: nothing to check yet` : renderReport(report));
process.exit(report.violations.length ? 1 : 0);
