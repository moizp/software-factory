import * as fs from 'fs';
import * as path from 'path';
import { checkClaudeMd, claudeMdFile, readClaudeMd } from '../../claudemd';
import { parseBoard } from '../../board';
import { validateContract, stubPayload } from '../../contracts';
import { lintCommitMessage } from '../../gate/commit-lint';
import { selectTests } from '../../gate/test-select';
import { languageFile, loadLanguage } from '../../language';
import { loadLookFeel, lookFeelFile } from '../../lookfeel';
import { loadCharacter, characterFile } from '../../character';
import { loadMission, missionFile } from '../../mission';
import { Policy, evaluatePolicy, parsePolicy } from '../../policy-engine';
import { AGENT_NAMES, agentFilePath } from '../../pipeline';
import { measurePrompts } from '../../prompts';
import { checkWiki, readWiki, staleDays, wikiDir } from '../../wiki';
import { exec, tail } from '../exec';
import { Check, Ctx, Result, fail, pass, skip, warn } from '../types';

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const bullets = (items: string[], max = 8): string => items.slice(0, max).map(i => `- ${i}`).join('\n') + (items.length > max ? `\n- ... ${items.length - max} more` : '');

/** The glob with its wildcards filled in, as a path the glob matches. */
const sample = (glob: string): string => glob.replace(/\*\*\/?/g, 'a/b/').replace(/\*/g, 'x').replace(/\?/g, 'x').replace(/\/$/, '/x');

function loadProjectPolicy(ctx: Ctx): { policy: Policy } | { error: string } | { absent: true } {
  const file = path.join(ctx.projectDir, '.factory', 'policy.json');
  if (!fs.existsSync(file)) return { absent: true };
  try { return { policy: parsePolicy(JSON.parse(fs.readFileSync(file, 'utf-8'))) }; } catch (e) { return { error: (e as Error).message }; }
}

/** A declaration that is absent is a skip with the step that writes it; one that is present but unusable is a failure. */
function declaration(id: string, title: string, absent: string, next: string, read: (ctx: Ctx) => { found: false } | { found: true; summary: string } | { found: true; errors: string[] } | { found: true; skipped: string }): Check {
  return {
    id,
    tier: 'offline',
    title,
    run: ctx => {
      const r = read(ctx);
      if (!r.found) return skip(absent, next);
      if ('errors' in r) return fail(`${r.errors.length} problem(s)`, bullets(r.errors), next);
      if ('skipped' in r) return warn(`not used by the agents: ${r.skipped}`, undefined, next);
      return pass(r.summary);
    }
  };
}

export const offlineChecks: Check[] = [
  {
    id: 'offline.typecheck',
    tier: 'offline',
    title: 'The factory compiles',
    run: ctx => {
      const r = exec(NPX, ['tsc', '--noEmit', '-p', '.'], { cwd: ctx.factoryRoot, timeoutMs: 300_000 });
      return r.code === 0 ? pass('tsc found no errors') : fail('tsc reported errors', tail(r.stdout + r.stderr, 30), 'Fix the compile errors, then run `npm run build`');
    }
  },
  {
    id: 'offline.unit',
    tier: 'offline',
    title: 'The factory\'s own test suite passes',
    run: ctx => {
      if (ctx.flags.quick) return skip('skipped by --quick', 'Run without --quick for the full suite (a few minutes)');
      const r = exec(NPX, ['jest', '--silent', '--forceExit'], { cwd: ctx.factoryRoot, timeoutMs: 900_000, env: { ...process.env, FACTORY_VERIFY_INNER: '1' } });
      const summary = (r.stderr + r.stdout).split('\n').filter(l => /^(Tests|Test Suites):/.test(l.trim())).map(l => l.trim()).join('; ');
      return r.code === 0 ? pass(summary || 'all tests passed') : fail(summary || 'tests failed', tail(r.stderr + r.stdout, 60), 'Run `npx jest` and fix the first failing test');
    }
  },
  {
    id: 'offline.agents',
    tier: 'offline',
    title: 'Every agent has a prompt file and a reply that satisfies its contract',
    run: ctx => {
      const problems: string[] = [];
      for (const agent of AGENT_NAMES) {
        if (!fs.existsSync(agentFilePath(agent))) problems.push(`${agent}: no prompt file at ${path.relative(ctx.factoryRoot, agentFilePath(agent))}`);
        const errors = validateContract({ phase: agent, valid: true, ...stubPayload(agent) }, agent);
        if (errors.length) problems.push(`${agent}: ${errors.join('; ')}`);
      }
      return problems.length === 0 ? pass(`${AGENT_NAMES.length} agents`) : fail(`${problems.length} agent(s) broken`, bullets(problems), 'Restore the agent file or its contract in .factory/pipeline.ts');
    }
  },
  {
    id: 'offline.prompts',
    tier: 'offline',
    title: 'Agent prompts are within their token budgets',
    run: () => {
      const rows = measurePrompts();
      const over = rows.filter(r => r.over);
      return over.length === 0 ? pass(`${rows.length} prompts, largest ${Math.max(...rows.map(r => r.tokens))} tokens`) : fail(`${over.length} prompt(s) over budget`, bullets(over.map(r => `${r.agent}: ${r.tokens} tokens, budget ${r.budget}`)), 'Shorten the prompt, or raise its budget in .factory/prompt-budgets.json in a reviewed change');
    }
  },
  declaration('project.mission', 'MISSION.md parses', 'no MISSION.md: work is not checked against a mission', 'Run `/mission` in Claude Code, or copy templates/project/MISSION.md to the project root and fill it in', ctx => {
    const l = loadMission(missionFile(ctx.projectDir));
    if (!l.found) return { found: false };
    return l.result.ok ? { found: true, summary: `${l.result.mission.behaviourChanges.length} behaviour change(s)` } : { found: true, errors: l.result.errors };
  }),
  declaration('project.character', 'CHARACTER.md parses', 'no CHARACTER.md: the product is not built to a declared character', 'Run `/character` after the mission is written', ctx => {
    const m = loadMission(missionFile(ctx.projectDir));
    const l = loadCharacter(m.found && m.result.ok ? m.result.mission : undefined, characterFile(ctx.projectDir));
    if (!l.found) return { found: false };
    return l.result.ok ? { found: true, summary: `${l.result.character.traits.length} trait(s)` } : { found: true, errors: l.result.errors };
  }),
  declaration('project.lookfeel', 'LOOKFEEL.md parses', 'no LOOKFEEL.md: the interface is not built to a declared look and feel (fine for a project without a UI)', 'Run `/lookfeel` after the character is written', ctx => {
    const m = loadMission(missionFile(ctx.projectDir));
    const l = loadLookFeel(m.found && m.result.ok ? m.result.mission : undefined, lookFeelFile(ctx.projectDir));
    if (!l.found) return { found: false };
    return l.result.ok ? { found: true, summary: 'parses and its colours have a readable pair' } : { found: true, errors: l.result.errors };
  }),
  declaration('project.language', 'The glossary parses (when its Status is current)', 'no docs/wiki/glossary.md: agents are not given a ubiquitous language', 'Run `/language` once the wiki exists', ctx => {
    const l = loadLanguage(languageFile(ctx.projectDir));
    if (!l.found) return { found: false };
    if ('skipped' in l) return { found: true, skipped: l.skipped };
    return l.result.ok ? { found: true, summary: `${l.result.terms.length} term(s)` } : { found: true, errors: l.result.errors };
  }),
  declaration('project.wiki', 'The wiki passes its checks', 'no docs/wiki: nothing is recorded for later sessions', 'Copy templates/project/docs/wiki to docs/wiki and fill the draft pages from the repository', ctx => {
    const dir = wikiDir(ctx.projectDir);
    if (!fs.existsSync(dir)) return { found: false };
    const issues = checkWiki(readWiki(dir), { staleDays: staleDays(), exists: rel => fs.existsSync(path.resolve(dir, rel)) });
    const errors = issues.filter(i => i.severity === 'error').map(i => `${i.path}: ${i.message}`);
    return errors.length ? { found: true, errors } : { found: true, summary: `${Object.keys(readWiki(dir)).length} file(s), ${issues.length} piece(s) of advice` };
  }),
  declaration('project.claudemd', 'The project CLAUDE.md has its five sections', 'no CLAUDE.md at the project root', 'Run `/claude-md`, or copy templates/project/CLAUDE.md', ctx => {
    const md = readClaudeMd(claudeMdFile(ctx.projectDir));
    if (md === null) return { found: false };
    const issues = checkClaudeMd(md, { exists: p => fs.existsSync(path.resolve(ctx.projectDir, p)) });
    const errors = issues.filter(i => i.severity === 'error').map(i => i.message);
    return errors.length ? { found: true, errors } : { found: true, summary: `${issues.length} piece(s) of advice` };
  }),
  declaration('project.board', 'The Kanban board config parses', 'no .factory/board.json: no WIP limits', 'Copy .factory/board.json from the factory', ctx => {
    const file = path.join(ctx.projectDir, '.factory', 'board.json');
    if (!fs.existsSync(file)) return { found: false };
    try { const b = parseBoard(JSON.parse(fs.readFileSync(file, 'utf-8'))); return { found: true, summary: `${b.statuses.length} statuses` }; } catch (e) { return { found: true, errors: [(e as Error).message] }; }
  }),
  {
    id: 'project.policy',
    tier: 'offline',
    title: 'The merge policy parses and fails closed where it must',
    run: ctx => {
      const loaded = loadProjectPolicy(ctx);
      if ('absent' in loaded) return warn('no .factory/policy.json: every pull request waits for a person', undefined, 'Copy .factory/policy.json and policy-engine.ts from the factory and set the protected paths (docs/POLICY.md)');
      if ('error' in loaded) return fail(loaded.error, undefined, 'Fix .factory/policy.json (docs/POLICY.md)');
      const { policy } = loaded;
      const problems: string[] = [];
      const ordinary = { branch: 'feature/x', files: ['src/app/feature.ts'], changedLines: 10 };
      const say = (what: string, got: boolean, want: boolean) => { if (got !== want) problems.push(`${what}: autoMerge was ${got}, expected ${want}`); };

      say('an empty diff', evaluatePolicy(policy, { ...ordinary, files: [] }).autoMerge, false);
      for (const glob of policy.protected_paths) say(`a change to protected path ${glob}`, evaluatePolicy(policy, { ...ordinary, files: [sample(glob)] }).autoMerge, false);
      for (const label of policy.force_manual_labels ?? []) say(`the label ${label}`, evaluatePolicy(policy, { ...ordinary, labels: [label] }).autoMerge, false);
      say('a change to .factory/policy.json', evaluatePolicy(policy, { ...ordinary, files: ['.factory/policy.json'] }).autoMerge, false);

      const normal = evaluatePolicy(policy, ordinary);
      if (normal.autoMerge && !normal.require.includes('ci')) problems.push('an ordinary change may auto-merge without requiring ci');
      const manual = evaluatePolicy(policy, { ...ordinary, files: [] });
      if (manual.approvals < 1) problems.push('a change that needs a person asks for 0 approvals');
      return problems.length === 0
        ? pass(`${policy.protected_paths.length} protected path(s), ${policy.rules.length} rule(s); an ordinary change ${normal.autoMerge ? 'auto-merges after ' + normal.require.join(' + ') : 'waits for a person'}; empty diff, protected paths and force-manual labels all go to a person`)
        : fail(`${problems.length} fail-closed expectation(s) broken`, bullets(problems), 'Tighten .factory/policy.json: protected paths and labels must always send a change to a person (docs/POLICY.md)');
    }
  },
  {
    id: 'offline.gates',
    tier: 'offline',
    title: 'Commit message and test-selection gates behave',
    run: () => {
      const problems: string[] = [];
      if (lintCommitMessage('feat: add login form').errors.length) problems.push('a conventional single-line message was rejected');
      if (!lintCommitMessage('Added stuff').errors.length) problems.push('a message without a type was accepted');
      if (!lintCommitMessage('feat: add login\n\nCo-Authored-By: Claude <noreply@anthropic.com>').errors.length) problems.push('an attribution line was accepted');
      const sel = selectTests(['docs/readme.md'], []);
      if (sel.mode !== 'none') problems.push(`a docs-only change selected ${sel.mode} tests`);
      return problems.length === 0 ? pass('commit lint rejects loose messages and attribution; a docs-only change runs no tests') : fail(`${problems.length} gate(s) misbehave`, bullets(problems));
    }
  }
];
