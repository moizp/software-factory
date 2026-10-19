#!/usr/bin/env node
import { missionFile, loadMission, missionForAgents } from './mission';

// Usage: mission-cli [path] [--json]
// Checks a project's MISSION.md. Exit 1 when it cannot be used (errors); advice is printed and allowed.
const args = process.argv.slice(2).filter(a => a !== '--json');
const file = args[0] ? require('path').resolve(args[0]) : missionFile();
const load = loadMission(file);

if (!load.found) {
  console.error(`No mission file at ${file}. Start from templates/project/MISSION.md (see .claude/skills/mission.md).`);
  process.exit(1);
}
const { result } = load;
if (!result.ok) {
  console.error(`${file} cannot be used:`);
  result.errors.forEach(e => console.error(`- error: ${e}`));
  result.warnings.forEach(w => console.error(`- advice: ${w}`));
  process.exit(1);
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(missionForAgents(result.mission), null, 2));
} else {
  console.log(`${file}: ${result.mission.behaviourChanges.length} behaviour change(s) for ${result.mission.users.length} user group(s)`);
  result.mission.behaviourChanges.forEach(c => console.log(`  ${c.id}  ${c.name}`));
  result.warnings.forEach(w => console.log(`- advice: ${w}`));
}
