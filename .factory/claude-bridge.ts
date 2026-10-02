import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { WorkflowState, Phase } from './state';
import { agentFilePath } from './pipeline';

interface AgentResponse {
  phase: Phase;
  valid: boolean;
  output?: Record<string, unknown>;
  error?: string;
  artifacts?: Array<{
    type: string;
    content: Record<string, unknown>;
  }>;
}

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

  throw new Error(`Could not extract valid JSON from response (length: ${response.length})`);
}

function createAgentPrompt(
  agentMarkdown: AgentMarkdown,
  context: Record<string, unknown>
): string {
  const contextJson = JSON.stringify(context, null, 2);

  return `${agentMarkdown.instructions}

---

## INPUT CONTEXT

\`\`\`json
${contextJson}
\`\`\`

---

## INSTRUCTIONS

Process this input according to the instructions above. Return ONLY valid JSON output as specified in your "Output Format" section. Do not include any preamble, explanation, markdown formatting, or other text — output ONLY the JSON object.`;
}

export const DEFAULT_AGENT_TIMEOUT_MS = 10 * 60 * 1000;

function agentTimeoutMs(): number {
  const fromEnv = Number(process.env.FACTORY_AGENT_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_AGENT_TIMEOUT_MS;
}

/** Args for headless, tool-less, stateless agent runs (agents only emit JSON in this phase). */
export function buildCliArgs(): string[] {
  const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence'];
  if (process.env.FACTORY_AGENT_MODEL) {
    args.push('--model', process.env.FACTORY_AGENT_MODEL);
  }
  return args;
}

/** Unwraps `claude -p --output-format json`: throws on is_error, returns the model text. */
export function parseCliOutput(stdout: string): string {
  let parsed: { result?: unknown; is_error?: boolean; total_cost_usd?: number } | null = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return stdout.trim();
  }

  if (parsed && typeof parsed === 'object' && 'result' in parsed) {
    if (parsed.is_error) {
      throw new Error(`Claude CLI reported an error: ${String(parsed.result)}`);
    }
    if (typeof parsed.total_cost_usd === 'number') {
      console.debug(`[Agent] cost_usd=${parsed.total_cost_usd}`);
    }
    return String(parsed.result).trim();
  }
  return stdout.trim();
}

async function invokeClaudeAgentViaCli(
  prompt: string,
  timeout: number = agentTimeoutMs()
): Promise<string> {
  // Async spawn (not execSync) so parallel stages really run concurrently
  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', buildCliArgs(), { stdio: ['pipe', 'pipe', 'pipe'] });
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
          const text = parseCliOutput(stdout);
          if (code !== 0 && !stdout.trim()) {
            throw new Error(`Claude CLI exited with code ${code}. ${stderr.trim()}`);
          }
          resolve(text);
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
    try {
      console.debug(`[Agent] Invoking Claude CLI with ${timeout}ms timeout...`);
      response = await invokeClaudeAgentViaCli(prompt, timeout);
      console.debug(`[Agent] Received response (${response.length} chars)`);
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
      throw new Error(
        `Invalid agent response: missing phase or valid field. Got: ${JSON.stringify(jsonOutput)}`
      );
    }

    return jsonOutput as unknown as AgentResponse;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Agent] Error invoking ${agentName}: ${errorMsg}`);

    return {
      phase: agentName as Phase,
      valid: false,
      error: errorMsg,
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
