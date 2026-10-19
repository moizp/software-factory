#!/usr/bin/env node
import * as path from 'path';
import { checkClaudeMd, claudeMdFile, readClaudeMd } from './claudemd';
import * as fs from 'fs';

// Usage: claudemd-cli check [path] [--json]   check a project's CLAUDE.md (exit 1 on errors; advice is printed)
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'check') {
  const args = rest.filter(a => a !== '--json');
  const file = args[0] ? path.resolve(args[0]) : claudeMdFile();
  const md = readClaudeMd(file);
  if (md === null) {
    console.error(`No CLAUDE.md at ${file}. Start from templates/project/CLAUDE.md (see .claude/skills/project-claude-md.md).`);
    process.exit(1);
  }
  const root = path.dirname(file);
  const issues = checkClaudeMd(md, { exists: p => fs.existsSync(path.resolve(root, p)) });
  const errors = issues.filter(i => i.severity === 'error');
  if (rest.includes('--json')) console.log(JSON.stringify(issues, null, 2));
  else {
    issues.forEach(i => console.log(`${i.severity === 'error' ? 'error' : 'advice'}: ${i.message}`));
    console.log(`${file}: ${errors.length} error(s), ${issues.length - errors.length} piece(s) of advice`);
  }
  process.exit(errors.length ? 1 : 0);
} else {
  console.error('Usage: claudemd-cli check [path] [--json]');
  process.exit(2);
}
