#!/usr/bin/env node
import * as path from 'path';
import { CATALOGUE, FEELS, Feel, Style, findStyle, shortlist } from './lookfeel-catalogue';
import { loadLookFeel, lookFeelFile, lookFeelForAgents, renderLookFeelLine } from './lookfeel';
import { loadMission } from './mission';

// Usage:
//   lookfeel-cli check [path] [--json]   check a LOOKFEEL.md (exit 1 when it cannot be used)
//   lookfeel-cli catalogue [name]        list the styles, or describe one
//   lookfeel-cli shortlist <feelings>    styles that share the most feelings, such as calm,handmade,trustworthy
const [cmd, ...rest] = process.argv.slice(2);

function describe(st: Style): string {
  return [
    `${st.name} (${st.origin}): ${st.essence}`,
    `  materials    ${st.materials}`,
    `  form         ${st.form}`,
    `  colour       ${st.colour}`,
    `  motion       ${st.motion}`,
    `  sound        ${st.sound}`,
    `  interaction  ${st.interaction}`,
    `  feels        ${st.feel.join(', ')}`,
    `  take care    ${st.care}`
  ].join('\n');
}

if (cmd === 'check') {
  const args = rest.filter(a => a !== '--json');
  const file = args[0] ? path.resolve(args[0]) : lookFeelFile();
  const missionLoad = loadMission();
  const mission = missionLoad.found && missionLoad.result.ok ? missionLoad.result.mission : undefined;
  const load = loadLookFeel(mission, file);
  if (!load.found) {
    console.error(`No look and feel file at ${file}. Start from templates/project/LOOKFEEL.md (see .claude/skills/look-and-feel.md).`);
    process.exit(1);
  }
  if (!load.result.ok) {
    console.error(`${file} cannot be used:`);
    load.result.errors.forEach(e => console.error(`- error: ${e}`));
    load.result.warnings.forEach(w => console.error(`- advice: ${w}`));
    process.exit(1);
  }
  if (rest.includes('--json')) console.log(JSON.stringify(lookFeelForAgents(load.result.lookFeel), null, 2));
  else {
    console.log(`${file}: ${renderLookFeelLine(load.result.lookFeel)}${mission ? ' (checked against MISSION.md)' : ' (no MISSION.md to check the reasoning against)'}`);
    load.result.warnings.forEach(w => console.log(`- advice: ${w}`));
  }
} else if (cmd === 'catalogue') {
  if (rest[0]) {
    const st = findStyle(rest.join(' '));
    if (!st) { console.error(`No style called "${rest.join(' ')}". Run without a name to list them.`); process.exit(1); }
    console.log(describe(st));
  } else {
    CATALOGUE.forEach(st => console.log(`${st.name.padEnd(24)} ${st.feel.join(', ').padEnd(42)} ${st.essence}`));
    console.log(`\nFeelings: ${FEELS.join(', ')}`);
  }
} else if (cmd === 'shortlist') {
  const wanted = (rest[0] ?? '').split(/[,\s]+/).map(x => x.toLowerCase()).filter(Boolean);
  const bad = wanted.filter(w => !(FEELS as string[]).includes(w));
  if (wanted.length === 0 || bad.length) {
    console.error(`${bad.length ? `Unknown: ${bad.join(', ')}. ` : ''}Choose from: ${FEELS.join(', ')}`);
    process.exit(2);
  }
  shortlist(wanted as Feel[], 5).forEach(({ style, matched }) => console.log(`${style.name.padEnd(24)} matches ${matched.join(', ')}  |  ${style.essence}`));
} else {
  console.error('Usage: lookfeel-cli check [path] [--json] | catalogue [name] | shortlist <feelings>');
  process.exit(2);
}
