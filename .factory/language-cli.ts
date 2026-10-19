#!/usr/bin/env node
import * as path from 'path';
import { languageFile, languageForAgents, loadLanguage, renderLanguageLine } from './language';

// Usage: language-cli check [path] [--json]   check the glossary (exit 1 when it cannot be used)
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'check') {
  const args = rest.filter(a => a !== '--json');
  const file = args[0] ? path.resolve(args[0]) : languageFile();
  const load = loadLanguage(file);
  if (!load.found) {
    console.error(`No glossary at ${file}. Start from templates/project/docs/wiki/glossary.md (see .claude/skills/ubiquitous-language.md).`);
    process.exit(1);
  }
  if ('skipped' in load) {
    console.log(`${file}: not used by the agents, ${load.skipped}. Set Status to current once the terms are right.`);
    process.exit(0);
  }
  if (!load.result.ok) {
    console.error(`${file} cannot be used:`);
    load.result.errors.forEach(e => console.error(`- error: ${e}`));
    load.result.warnings.forEach(w => console.error(`- advice: ${w}`));
    process.exit(1);
  }
  if (rest.includes('--json')) console.log(JSON.stringify(languageForAgents(load.result.terms), null, 2));
  else {
    console.log(`${file}: ${renderLanguageLine(load.result.terms)}`);
    load.result.warnings.forEach(w => console.log(`- advice: ${w}`));
  }
} else {
  console.error('Usage: language-cli check [path] [--json]');
  process.exit(2);
}
