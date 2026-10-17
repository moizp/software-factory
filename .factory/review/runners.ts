import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCliResult } from '../claude-bridge';
import { LENS_SCHEMA } from './schema';
import { Runner, RunnerRequest, RunnerResponse } from './types';

const TIMEOUT_MS = 8 * 60 * 1000;

/** Args for a stateless, tool-less review call on the logged-in account. Never --bare: bare ignores OAuth. */
export function buildReviewCliArgs(req: RunnerRequest): string[] {
  const args = [
    '-p', '--output-format', 'json', '--tools', '', '--no-session-persistence',
    '--model', req.model,
    '--append-system-prompt', req.system,
    '--json-schema', JSON.stringify(LENS_SCHEMA)
  ];
  if (req.effort) args.push('--effort', req.effort);
  return args;
}

/** Personal-account runner: shells out to Claude Code with CLAUDE_CODE_OAUTH_TOKEN in the environment. */
export class CliRunner implements Runner {
  readonly kind = 'cli' as const;

  run(req: RunnerRequest): Promise<RunnerResponse> {
    // Empty cwd so the CLI loads no project CLAUDE.md or settings into the call.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-'));
    return new Promise((resolve, reject) => {
      const child = spawn('claude', buildReviewCliArgs(req), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('claude CLI timed out')); }, TIMEOUT_MS);
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => { clearTimeout(timer); reject(new Error(`claude CLI failed to start: ${e.message}`)); });
      child.on('close', code => {
        clearTimeout(timer);
        try {
          if (code !== 0 && !out.trim()) throw new Error(`claude CLI exited ${code}: ${err.trim().slice(0, 300)}`);
          const r = parseCliResult(out);
          resolve({
            text: r.text,
            usage: {
              inputTokens: r.usage?.inputTokens ?? 0,
              outputTokens: r.usage?.outputTokens ?? 0,
              cacheReadTokens: r.usage?.cacheReadTokens ?? 0,
              costUsd: r.usage?.costUsd ?? 0
            }
          });
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.on('error', () => { /* reported via close */ });
      child.stdin.end(req.prompt);
    });
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

/**
 * Fallback runner for an Anthropic API key. Plain fetch, so there is no SDK dependency.
 * Not yet exercised against the live API: the request shape follows the public Messages API
 * and the output is validated like any other, so a mismatch fails closed rather than passing.
 */
export class ApiRunner implements Runner {
  readonly kind = 'api' as const;

  constructor(private readonly apiKey: string, private readonly fetchImpl: Fetch = fetch as unknown as Fetch) {}

  async run(req: RunnerRequest): Promise<RunnerResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.prompt }]
    };
    if (req.effort) body.output_config = { effort: req.effort };

    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Anthropic API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') {
      throw new Error(`review stopped early: ${data.stop_reason}`);
    }
    const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const u = data.usage ?? {};
    return {
      text,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        costUsd: 0
      }
    };
  }
}
