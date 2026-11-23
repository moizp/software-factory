import * as fs from 'fs';
import * as path from 'path';
import { Check, Ctx, fail, pass, skip, warn } from '../types';

type VersionScript = { check(root: string, o?: { version?: string }): string[]; lastTag(root: string): string | null };
const script = (ctx: Ctx): VersionScript => require(path.join(ctx.factoryRoot, 'templates', 'release', 'scripts', 'version.cjs')) as VersionScript;
const triple = (v: unknown): number[] | null => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v)); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const readJson = (file: string): Record<string, any> | null => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; } };

export const versionChecks: Check[] = [
  {
    id: 'project.version',
    tier: 'offline',
    title: 'package.json and package-lock.json carry the same version',
    run: ctx => {
      if (!fs.existsSync(path.join(ctx.projectDir, 'package.json'))) return skip('no package.json');
      const problems = script(ctx).check(ctx.projectDir);
      if (problems.length) return fail(`${problems.length} disagreement(s)`, problems.map(p => `- ${p}`).join('\n'), 'Run `node scripts/version.cjs bump --version X.Y.Z` (or `npm run version:bump`): it writes both files');
      const pkg = readJson(path.join(ctx.projectDir, 'package.json'));
      const tag = script(ctx).lastTag(ctx.projectDir);
      return pass(`${pkg?.version} in package.json and package-lock.json; last release ${tag ?? 'none yet'}`);
    }
  },
  {
    id: 'project.factory',
    tier: 'offline',
    title: 'The project records which factory version it was started from',
    run: ctx => {
      const mine = triple(readJson(path.join(ctx.factoryRoot, 'package.json'))?.version);
      if (path.resolve(ctx.projectDir) === path.resolve(ctx.factoryRoot)) return skip('this is the factory itself');
      const recorded = readJson(path.join(ctx.projectDir, 'project.config.json'))?.factory_version;
      if (!recorded) return warn('project.config.json has no "factory_version"', undefined, `Add "factory_version": "${mine ? mine.join('.') : 'X.Y.Z'}" to project.config.json: the factory version the practices and templates were copied from`);
      const theirs = triple(recorded);
      if (!theirs || !mine) return fail(`"factory_version" ${JSON.stringify(recorded)} is not X.Y.Z`, undefined, 'Use the factory version, such as "1.0.0"');
      const behind = theirs[0] !== mine[0] ? 'major' : theirs[1] !== mine[1] ? 'minor' : 'patch';
      const older = theirs[0] - mine[0] || theirs[1] - mine[1] || theirs[2] - mine[2];
      if (theirs.join() === mine.join()) return pass(`started from factory ${recorded}, the version running now`);
      if (older < 0) return warn(`started from factory ${recorded}; this factory is ${mine.join('.')} (${behind} behind)`, undefined, 'Read CHANGELOG.md in the factory for what changed, adopt what you want, then update "factory_version"');
      return warn(`started from factory ${recorded}, newer than this factory (${mine.join('.')})`, undefined, 'Update the factory checkout you are running');
    }
  }
];
