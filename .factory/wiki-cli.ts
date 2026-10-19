#!/usr/bin/env node
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { INDEX_FILE, checkWiki, pageSourcePaths, parsePage, readWiki, renderIndex, scaffold, staleDays, updateIndex, wikiDir } from './wiki';

// Usage:
//   wiki-cli check [--json]                    check the wiki (exit 1 on errors; warnings are printed)
//   wiki-cli index [--write]                   print the generated index, or write it into README.md
//   wiki-cli new <path> "<Title>" [--current]  start a page (a draft unless --current) and refresh the index
//   wiki-cli drift                             current pages whose source files changed since they were last verified
const [cmd, ...rest] = process.argv.slice(2);
const dir = wikiDir();
const today = new Date().toISOString().slice(0, 10);
const repoRoot = (): string => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' }).trim();

function writeIndex(): boolean {
  const readme = path.join(dir, INDEX_FILE);
  if (!fs.existsSync(readme)) return false;
  fs.writeFileSync(readme, updateIndex(fs.readFileSync(readme, 'utf-8'), readWiki(dir)));
  return true;
}

if (cmd === 'check') {
  if (!fs.existsSync(dir)) { console.error(`No wiki at ${dir}. Copy templates/project/docs/wiki there (see .claude/skills/wiki.md).`); process.exit(1); }
  const exists = (rel: string) => fs.existsSync(path.resolve(dir, rel));
  const issues = checkWiki(readWiki(dir), { staleDays: staleDays(), exists });
  const errors = issues.filter(i => i.severity === 'error');
  if (rest.includes('--json')) console.log(JSON.stringify(issues, null, 2));
  else {
    issues.forEach(i => console.log(`${i.severity === 'error' ? 'error' : 'advice'}: ${i.path}: ${i.message}`));
    console.log(`${dir}: ${Object.keys(readWiki(dir)).length - 1} page(s), ${errors.length} error(s), ${issues.length - errors.length} piece(s) of advice`);
  }
  process.exit(errors.length > 0 ? 1 : 0);
} else if (cmd === 'index') {
  if (rest.includes('--write')) {
    try { if (!writeIndex()) { console.error(`No ${INDEX_FILE} in ${dir}.`); process.exit(1); } } catch (e) { console.error((e as Error).message); process.exit(1); }
    console.log(`index written to ${path.join(dir, INDEX_FILE)}`);
  } else console.log(renderIndex(readWiki(dir)));
} else if (cmd === 'new') {
  const [rel, ...title] = rest.filter(a => a !== '--current');
  const name = (title.join(' ')).trim();
  if (!rel || !name) { console.error('Usage: wiki-cli new <path inside the wiki, such as architecture/overview.md> "<Title>" [--current]'); process.exit(2); }
  const file = path.resolve(dir, rel.endsWith('.md') ? rel : `${rel}.md`);
  if (!file.startsWith(dir + path.sep)) { console.error('The page must be inside the wiki directory.'); process.exit(2); }
  if (fs.existsSync(file)) { console.error(`${file} already exists.`); process.exit(1); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, scaffold(name, today, rest.includes('--current') ? 'current' : 'draft'));
  console.log(`created ${file}${writeIndex() ? ' and refreshed the index' : ''}`);
} else if (cmd === 'drift') {
  const files = readWiki(dir);
  const root = repoRoot();
  let drifted = 0;
  for (const [file, md] of Object.entries(files)) {
    if (file === INDEX_FILE) continue;
    const pg = parsePage(file, md);
    if (pg.status !== 'current' || !pg.verified) continue;
    for (const src of pageSourcePaths(pg)) {
      const abs = path.resolve(root, src);
      if (!fs.existsSync(abs)) { console.log(`${file}: source ${src} no longer exists`); drifted++; continue; }
      const log = execFileSync('git', ['log', `--since=${pg.verified}T23:59:59`, '--oneline', '--', src], { cwd: root, encoding: 'utf-8' }).trim();
      if (log) { const n = log.split('\n').length; console.log(`${file}: ${src} changed in ${n} commit(s) since ${pg.verified}`); drifted++; }
    }
  }
  console.log(drifted ? `${drifted} source(s) to re-check` : 'no source has changed since its page was last verified');
} else {
  console.error('Usage: wiki-cli check [--json] | index [--write] | new <path> "<Title>" [--current] | drift');
  process.exit(2);
}
