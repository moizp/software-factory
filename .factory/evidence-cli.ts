#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Label, captureEvidence, readManifest } from './evidence/capture';
import { parsePreview, parseVisualChecks } from './evidence/checks';
import { publishEvidence } from './evidence/publish';
import { renderEvidence } from './evidence/render';
import { parsePlan } from './plan';

// Usage:
//   evidence-cli capture --label before|after [--checks <file>] [--out <dir>]
//   evidence-cli publish --issue <n> --commit <sha> [--out <dir>] [--md <file>]
//
// capture   starts the app (project.config.json "preview"), photographs the screens, writes <out>/<label>/
// publish   commits <out>/before and <out>/after to the evidence branch and writes the Evidence section to --md
// --checks  a JSON list of screens, or a plan file whose phases carry visual_checks (default: visual-checks.json)
const [cmd, ...rest] = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = rest.findIndex(a => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return rest[i].includes('=') ? rest[i].slice(rest[i].indexOf('=') + 1) : rest[i + 1];
};
const die = (msg: string, code = 1): never => { console.error(msg); process.exit(code); };

const cwd = process.cwd();
const out = path.resolve(value('--out') ?? path.join(cwd, 'evidence'));

function loadChecks(file: string) {
  if (!fs.existsSync(file)) return die(`No screens listed at ${file}. Write the plan's visual_checks there (a JSON list of { name, path, widths }).`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.phases)) {
    const plan = parsePlan(raw);
    if (!plan.ok) return die(plan.error);
    const seen = new Set<string>();
    return plan.plan.phases.flatMap(p => p.visual_checks ?? []).filter(c => (seen.has(c.name) ? false : (seen.add(c.name), true)));
  }
  const parsed = parseVisualChecks(raw, path.basename(file));
  return parsed.ok ? parsed.value : die(parsed.error);
}

(async () => {
  if (cmd === 'capture') {
    const given = value('--label');
    if (given !== 'before' && given !== 'after') return die('--label must be "before" or "after"', 2);
    const label: Label = given;
    const configFile = path.join(cwd, 'project.config.json');
    if (!fs.existsSync(configFile)) die('No project.config.json here.');
    const preview = parsePreview(JSON.parse(fs.readFileSync(configFile, 'utf-8')).preview);
    if (!preview.ok) return die(preview.error);
    const checks = loadChecks(path.resolve(value('--checks') ?? 'visual-checks.json'));
    const m = await captureEvidence({ cwd, preview: preview.value, checks, label, outDir: out });
    console.log(`${m.shots.length} picture(s) for "${label}" at ${m.commit.slice(0, 7)} written to ${path.join(out, label)}`);
  } else if (cmd === 'publish') {
    const issue = Number(value('--issue'));
    const commit = value('--commit');
    if (!Number.isInteger(issue) || !commit) return die('Usage: evidence-cli publish --issue <n> --commit <sha> [--out <dir>] [--md <file>]', 2);
    const published = publishEvidence({ cwd, issue, commit, outDir: out });
    const md = renderEvidence(readManifest(path.join(out, 'before')), readManifest(path.join(out, 'after')), published.urlFor);
    const mdFile = path.resolve(value('--md') ?? path.join(out, 'evidence.md'));
    fs.writeFileSync(mdFile, md + '\n');
    console.log(`published to the evidence branch at ${published.commit.slice(0, 7)} (${published.prefix}); section written to ${mdFile}`);
  } else {
    die('Usage: evidence-cli capture --label before|after | publish --issue <n> --commit <sha>', 2);
  }
})().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
