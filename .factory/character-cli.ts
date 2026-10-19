#!/usr/bin/env node
import * as path from 'path';
import { ARCHETYPES, Archetype, findArchetype, shortlistArchetypes } from './character-catalogue';
import { characterFile, characterForAgents, loadCharacter, renderCharacterLine } from './character';
import { FEELS, Feel } from './lookfeel-catalogue';
import { loadMission } from './mission';

// Usage:
//   character-cli check [path] [--json]   check a CHARACTER.md (exit 1 when it cannot be used)
//   character-cli catalogue [name]        list the archetypes, or describe one
//   character-cli shortlist <feelings>    archetypes that share the most feelings, such as warm,calm,trustworthy
const [cmd, ...rest] = process.argv.slice(2);

function describe(a: Archetype): string {
  return [
    `${a.name}: ${a.essence}`,
    `  acts       ${a.acts}`,
    `  speaks     ${a.speaks}`,
    `  promise    ${a.promise}`,
    `  feels      ${a.feel.join(', ')}`,
    `  take care  ${a.care}`
  ].join('\n');
}

if (cmd === 'check') {
  const args = rest.filter(a => a !== '--json');
  const file = args[0] ? path.resolve(args[0]) : characterFile();
  const missionLoad = loadMission();
  const mission = missionLoad.found && missionLoad.result.ok ? missionLoad.result.mission : undefined;
  const load = loadCharacter(mission, file);
  if (!load.found) {
    console.error(`No character file at ${file}. Start from templates/project/CHARACTER.md (see .claude/skills/character.md).`);
    process.exit(1);
  }
  if (!load.result.ok) {
    console.error(`${file} cannot be used:`);
    load.result.errors.forEach(e => console.error(`- error: ${e}`));
    load.result.warnings.forEach(w => console.error(`- advice: ${w}`));
    process.exit(1);
  }
  if (rest.includes('--json')) console.log(JSON.stringify(characterForAgents(load.result.character), null, 2));
  else {
    console.log(`${file}: ${renderCharacterLine(load.result.character)}${mission ? ' (checked against MISSION.md)' : ' (no MISSION.md to check the reasoning against)'}`);
    load.result.warnings.forEach(w => console.log(`- advice: ${w}`));
  }
} else if (cmd === 'catalogue') {
  if (rest[0]) {
    const a = findArchetype(rest.join(' '));
    if (!a) { console.error(`No archetype called "${rest.join(' ')}". Run without a name to list them.`); process.exit(1); }
    console.log(describe(a));
  } else {
    ARCHETYPES.forEach(a => console.log(`${a.name.padEnd(12)} ${a.feel.join(', ').padEnd(40)} ${a.essence}`));
    console.log(`\nFeelings: ${FEELS.join(', ')}`);
  }
} else if (cmd === 'shortlist') {
  const wanted = (rest[0] ?? '').split(/[,\s]+/).map(x => x.toLowerCase()).filter(Boolean);
  const bad = wanted.filter(w => !(FEELS as string[]).includes(w));
  if (wanted.length === 0 || bad.length) {
    console.error(`${bad.length ? `Unknown: ${bad.join(', ')}. ` : ''}Choose from: ${FEELS.join(', ')}`);
    process.exit(2);
  }
  shortlistArchetypes(wanted as Feel[], 4).forEach(({ archetype, matched }) => console.log(`${archetype.name.padEnd(12)} matches ${matched.join(', ')}  |  ${archetype.essence}`));
} else {
  console.error('Usage: character-cli check [path] [--json] | catalogue [name] | shortlist <feelings>');
  process.exit(2);
}
