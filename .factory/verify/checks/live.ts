import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentEffort, agentModel, invokeClaudeAgent } from '../../claude-bridge';
import { FactoryOrchestrator } from '../../orchestrator';
import { AgentName } from '../../pipeline';
import { WorkflowState } from '../../state';
import { exec } from '../exec';
import { copyDeclarations } from '../sample-project';
import { Check, fail, pass, skip, warn } from '../types';

/**
 * Opt-in: asks the real model. Runs from the first agent up to `product-manager` (--live) or `software-architect`
 * (--live=plan) with plan approval off and a token cap, in a copy of the project's declarations, and reports what each
 * call cost and whether any reply had to be re-asked.
 */
export const liveChecks: Check[] = [
  {
    id: 'live.agents',
    tier: 'live',
    title: 'Real agents return replies that satisfy their contracts',
    run: async ctx => {
      const mode = ctx.flags.live;
      if (!mode) return skip('not asked for', 'Add `--live` (product manager only) or `--live=plan` (through the architect) to spend a few model calls');
      const who = exec('claude', ['--version'], { timeoutMs: 20_000 });
      if (who.missing || who.code !== 0) return fail('claude CLI is not usable', who.stderr, 'Install Claude Code and log in by running `claude` once');

      const until: AgentName = mode === 'plan' ? 'software-architect' : 'product-manager';
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-verify-live-'));
      const data = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-verify-live-data-'));
      const saved = { cwd: process.cwd(), env: { ...process.env }, console: { log: console.log, info: console.info, debug: console.debug, warn: console.warn } };
      const log: Array<{ agent: string; tokens: number; ms: number; ok: boolean; error?: string; repair: boolean }> = [];
      try {
        const copied = copyDeclarations(ctx.projectDir, dir);
        if (!copied.includes('project.config.json')) fs.writeFileSync(path.join(dir, 'project.config.json'), JSON.stringify({ name: 'verify', mcp_servers: {} }));
        for (const k of Object.keys(process.env)) if (/^(GITHUB_|FACTORY_)/.test(k)) delete process.env[k];
        Object.assign(process.env, { FACTORY_DATA_DIR: data, FACTORY_IGNORE_WIP: '1', FACTORY_PLAN_APPROVAL: '0', FACTORY_MAX_TOKENS: String(ctx.flags.tokenCap) });
        process.chdir(dir);
        console.log = console.info = console.debug = console.warn = () => {};

        const counted = async (state: WorkflowState, agent: string, input: Record<string, unknown>) => {
          const started = Date.now();
          const r = await invokeClaudeAgent(state, agent, input);
          log.push({ agent, tokens: r.usage?.totalTokens ?? 0, ms: Date.now() - started, ok: r.valid, error: r.error, repair: 'repair' in input });
          return r;
        };
        const state = await new FactoryOrchestrator(counted as any, false).executeWorkflow(ctx.flags.brief, undefined, undefined, undefined, { until });

        const tokens = log.reduce((n, c) => n + c.tokens, 0);
        const repairs = log.filter(c => c.repair).length;
        const table = log.map(c => `${c.agent}: ${c.ok ? 'valid' : 'NOT valid'}${c.repair ? ' (re-ask)' : ''}, ${c.tokens} tokens, ${(c.ms / 1000).toFixed(1)} s${c.error ? ` - ${c.error.slice(0, 160)}` : ''}`);
        const head = `${agentModel()} at effort ${agentEffort()}: ${log.length} call(s), ${repairs} re-ask(s), ${tokens} tokens, up to ${until}`;
        const ended = state.status === 'paused' && state.phases.some(p => p.phase === until && p.valid) ? true : state.status === 'completed';
        if (!ended) return fail(`${head}; the run ended ${state.status}`, `${table.join('\n')}\n\nNotes:\n${state.notes.slice(-6).join('\n')}`, 'Read the notes above; a reply that broke its contract twice is the usual cause. Paste this report here to have it fixed');
        return repairs > 0 ? warn(`${head}; replies needed a re-ask`, table.join('\n'), 'A re-ask means the first reply broke the contract; paste this report so the prompt can be tightened') : pass(head, table.join('\n'));
      } catch (e) {
        return fail(`threw: ${(e as Error).message}`, log.map(c => `${c.agent}: ${c.ok}`).join('\n'));
      } finally {
        Object.assign(console, saved.console);
        process.chdir(saved.cwd);
        for (const k of Object.keys(process.env)) delete process.env[k];
        Object.assign(process.env, saved.env);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(data, { recursive: true, force: true });
      }
    }
  }
];
