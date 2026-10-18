import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';
import { WorkflowState, Phase, Usage } from './state';
import { agentFilePath } from './pipeline';
import { FailureMarker, RepairNote, trimProblem } from './repair';

interface AgentResponse {
  phase: Phase;
  valid: boolean;
  output?: Record<string, unknown>;
  error?: string;
  artifacts?: Array<{
    type: string;
    content: Record<string, unknown>;
  }>;
  usage?: Usage;
  /** Set when the model's text could not be read as a response envelope (the orchestrator may re-ask once). */
  failure?: FailureMarker;
}

/** The model answered, but not with a usable response object. Distinct from the CLI failing to run. */
class MalformedOutputError extends Error {}

interface AgentMarkdown {
  instructions: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

function readAgentMarkdown(agentName: string): AgentMarkdown {
  const agentPath = agentFilePath(agentName);

  if (!fs.existsSync(agentPath)) {
    throw new Error(`Agent markdown not found: ${agentPath}`);
  }

  const content = fs.readFileSync(agentPath, 'utf-8');
  return {
    instructions: content,
  };
}

function extractJsonFromResponse(response: string): Record<string, unknown> {
  if (!response || response.trim().length === 0) {
    throw new Error('Empty response from agent');
  }

  // Try to find a JSON code block first
  const jsonCodeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonCodeBlockMatch) {
    const extracted = jsonCodeBlockMatch[1].trim();
    try {
      return JSON.parse(extracted);
    } catch (e) {
      console.debug('Failed to parse JSON from code block:', e);
    }
  }

  // Try to find raw JSON object - look for { ... }
  let braceCount = 0;
  let startIdx = -1;
  for (let i = 0; i < response.length; i++) {
    if (response[i] === '{') {
      if (braceCount === 0) startIdx = i;
      braceCount++;
    } else if (response[i] === '}') {
      braceCount--;
      if (braceCount === 0 && startIdx !== -1) {
        const jsonStr = response.substring(startIdx, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch (e) {
          console.debug('Failed to parse extracted JSON:', e);
        }
      }
    }
  }

  throw new MalformedOutputError(`Could not extract valid JSON from response (length: ${response.length})`);
}

export function createAgentPrompt(
  agentMarkdown: AgentMarkdown,
  context: Record<string, unknown>
): string {
  // A repair note is shown as its own section, not buried in the JSON context.
  const { repair, ...rest } = context as Record<string, unknown> & { repair?: RepairNote };
  // Compact JSON: indentation is wasted tokens
  const contextJson = JSON.stringify(rest);
  const repairSection = repair
    ? `\n## YOUR PREVIOUS REPLY WAS REJECTED (attempt ${repair.attempt})\n\n${trimProblem(repair.problem)}\n\nReturn the complete JSON object again with that fixed. No apology and no explanation.\n\n---\n`
    : '';

  return `${agentMarkdown.instructions}

---

## INPUT CONTEXT

\`\`\`json
${contextJson}
\`\`\`

---
${repairSection}
## INSTRUCTIONS

Process this input according to the instructions above. Return ONLY valid JSON output as specified in your "Output Format" section. Do not include any preamble, explanation, markdown formatting, or other text — output ONLY the JSON object.

If you cannot proceed without a decision only a person can make, do not guess. Return {"phase":"<your phase>","valid":false,"needs_human":{"intent":"clarify|approve|choose","question":"...","context":"...","urgency":"low|medium|high","format":"free_text|yes_no|multiple_choice","choices":["..."]}} (choices only for multiple_choice). If humanAnswers is in the input, a person already decided those points: follow them and do not ask again.`;
}

export const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;

function agentTimeoutMs(): number {
  const fromEnv = Number(process.env.FACTORY_AGENT_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_AGENT_TIMEOUT_MS;
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_EFFORT = 'medium';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export function agentModel(): string {
  return process.env.FACTORY_AGENT_MODEL || DEFAULT_MODEL;
}

export function agentEffort(): string {
  const effort = process.env.FACTORY_AGENT_EFFORT || DEFAULT_EFFORT;
  if (!EFFORTS.includes(effort)) {
    console.warn(`[Agent] Ignoring invalid FACTORY_AGENT_EFFORT "${effort}", using ${DEFAULT_EFFORT}`);
    return DEFAULT_EFFORT;
  }
  return effort;
}

/** Args for headless, tool-less, stateless agent runs (agents only emit JSON in this phase). */
export function buildCliArgs(): string[] {
  return [
    '-p', '--output-format', 'json', '--tools', '', '--no-session-persistence',
    '--model', agentModel(), '--effort', agentEffort()
  ];
}

let emptyCwd: string | null = null;

/**
 * Agents run from an empty directory: from the repo the CLI would load CLAUDE.md and
 * project settings into every call (about 9,400 tokens vs about 2,500 measured).
 */
function agentCwd(): string {
  if (!emptyCwd || !fs.existsSync(emptyCwd)) {
    emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-agent-'));
  }
  return emptyCwd;
}

export interface CliResult {
  text: string;
  usage?: Usage;
}

/** Unwraps `claude -p --output-format json`: throws on is_error, returns the model text and measured usage. */
export function parseCliResult(stdout: string): CliResult {
  let parsed: any = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { text: stdout.trim() };
  }

  if (parsed && typeof parsed === 'object' && 'result' in parsed) {
    if (parsed.is_error) {
      throw new Error(`Claude CLI reported an error: ${String(parsed.result)}`);
    }
    const u = parsed.usage ?? {};
    const inputTokens = u.input_tokens ?? 0;
    const outputTokens = u.output_tokens ?? 0;
    const cacheReadTokens = u.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
    return {
      text: String(parsed.result).trim(),
      usage: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
        costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
        turns: typeof parsed.num_turns === 'number' ? parsed.num_turns : 1
      }
    };
  }
  return { text: stdout.trim() };
}

export function parseCliOutput(stdout: string): string {
  return parseCliResult(stdout).text;
}

async function invokeClaudeAgentViaCli(
  prompt: string,
  timeout: number = agentTimeoutMs()
): Promise<CliResult> {
  // Async spawn (not execSync) so parallel stages really run concurrently
  return new Promise<CliResult>((resolve, reject) => {
    const child = spawn('claude', buildCliArgs(), { stdio: ['pipe', 'pipe', 'pipe'], cwd: agentCwd() });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`Claude CLI timeout after ${timeout}ms`)));
    }, timeout);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => reject(new Error(
        error.code === 'ENOENT'
          ? 'Claude CLI not found. Ensure "claude" command is in PATH. Install Claude Code or add it to your PATH.'
          : `Failed to invoke Claude CLI: ${error.message}`
      )));
    });

    child.on('close', code => {
      finish(() => {
        try {
          // A non-zero exit can still carry a structured error on stdout
          const result = parseCliResult(stdout);
          if (code !== 0 && !stdout.trim()) {
            throw new Error(`Claude CLI exited with code ${code}. ${stderr.trim()}`);
          }
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });

    child.stdin.on('error', () => { /* child exited early; reported via close */ });
    child.stdin.end(prompt);
  });
}

export async function invokeClaudeAgent(
  state: WorkflowState,
  agentName: string,
  input: Record<string, unknown>,
  timeout: number = agentTimeoutMs()
): Promise<AgentResponse> {
  try {
    console.debug(`[Agent] Invoking ${agentName}...`);

    // Load agent markdown
    const agentMarkdown = readAgentMarkdown(agentName);
    console.debug(`[Agent] Loaded ${agentName}.md (${agentMarkdown.instructions.length} chars)`);

    // Create prompt
    const prompt = createAgentPrompt(agentMarkdown, input);
    console.debug(`[Agent] Created prompt (${prompt.length} chars)`);

    // Invoke Claude via headless CLI
    let response: string;
    let usage: Usage | undefined;
    try {
      console.debug(`[Agent] Invoking Claude CLI (${agentModel()}, effort ${agentEffort()}) with ${timeout}ms timeout...`);
      const result = await invokeClaudeAgentViaCli(prompt, timeout);
      response = result.text;
      usage = result.usage;
      console.debug(`[Agent] Received response (${response.length} chars, ${usage?.totalTokens ?? '?'} tokens)`);
    } catch (cliError) {
      const msg = cliError instanceof Error ? cliError.message : String(cliError);
      console.error(`[Agent] CLI invocation failed: ${msg}`);
      throw new Error(`Failed to invoke agent via Claude CLI: ${msg}`);
    }

    // Extract JSON from response
    const jsonOutput = extractJsonFromResponse(response);
    console.debug(`[Agent] Extracted JSON with keys: ${Object.keys(jsonOutput).join(', ')}`);

    // Validate response structure - type assertion after validation
    if (!jsonOutput.phase || typeof jsonOutput.valid !== 'boolean') {
      throw new MalformedOutputError(
        `Invalid agent response: missing phase or valid field. Got: ${trimProblem(JSON.stringify(jsonOutput), 300)}`
      );
    }

    // Measured usage always overrides anything the model wrote under the same key
    return { ...(jsonOutput as unknown as AgentResponse), usage };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Agent] Error invoking ${agentName}: ${errorMsg}`);

    return {
      phase: agentName as Phase,
      valid: false,
      error: errorMsg,
      ...(error instanceof MalformedOutputError ? { failure: 'malformed_output' as const } : {})
    };
  }
}

export async function invokeClaudeAgentWithTimeout(
  state: WorkflowState,
  agentName: string,
  input: Record<string, unknown>,
  timeoutSeconds: number = agentTimeoutMs() / 1000
): Promise<AgentResponse> {
  const timeoutMs = timeoutSeconds * 1000;

  return Promise.race([
    invokeClaudeAgent(state, agentName, input, timeoutMs),
    new Promise<AgentResponse>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Agent timeout: ${agentName}`)),
        timeoutMs
      )
    ),
  ]).catch((error) => ({
    phase: agentName as Phase,
    valid: false,
    error: error instanceof Error ? error.message : String(error),
  }));
}

export function getAvailableAgents(): string[] {
  const agentsDir = path.join(__dirname, '..', '.claude', 'agents');

  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  return fs.readdirSync(agentsDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace('.md', ''));
}
