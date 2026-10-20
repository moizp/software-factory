import * as fs from 'fs';
import * as path from 'path';

const example = (factoryRoot: string, skill: string): string => {
  const text = fs.readFileSync(path.join(factoryRoot, '.claude', 'skills', skill), 'utf-8');
  const m = /```markdown\n([\s\S]*?)```/.exec(text);
  if (!m) throw new Error(`.claude/skills/${skill} has no markdown example to build a sample project from`);
  return m[1];
};

/**
 * A throwaway project whose declarations are the worked examples in the skills. They are known to parse, so a run on it
 * exercises everything the factory does with a mission, a character, a look and feel and a glossary, without a person
 * having to write those first. Never written into a real project.
 */
export function writeSampleProject(dir: string, factoryRoot: string): void {
  fs.mkdirSync(path.join(dir, 'docs', 'wiki'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'MISSION.md'), example(factoryRoot, 'mission.md'));
  fs.writeFileSync(path.join(dir, 'CHARACTER.md'), example(factoryRoot, 'character.md'));
  fs.writeFileSync(path.join(dir, 'LOOKFEEL.md'), example(factoryRoot, 'look-and-feel.md'));
  fs.writeFileSync(path.join(dir, 'docs', 'wiki', 'glossary.md'), example(factoryRoot, 'ubiquitous-language.md'));
  fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({ name: 'Sample', mcp_servers: {} }, null, 2));
  fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), '# Sample project\n');
}

/** Copies the declaration files a project has into `dir`, so a run reads the project's own words and never changes them. */
export function copyDeclarations(from: string, dir: string): string[] {
  const files = ['MISSION.md', 'CHARACTER.md', 'LOOKFEEL.md', 'project.config.json', path.join('docs', 'wiki', 'glossary.md'), path.join('.claude', 'CLAUDE.md')];
  const copied: string[] = [];
  for (const rel of files) {
    const src = path.join(from, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, rel));
    copied.push(rel);
  }
  return copied;
}
