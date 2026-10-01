import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { WorkflowState, Phase } from './state';

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
  const agentPath = path.join(
    __dirname,
    '..',
    '.claude',
    'agents',
    `${agentName}.md`
  );

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

async function invokeClaudeAgentViaApi(
  prompt: string,
  timeout: number = 30000
): Promise<string> {
  throw new Error(
    'API invocation not implemented. This factory uses the Claude CLI method only. ' +
    'Ensure "claude" command is available in PATH and authenticated.'
  );
}

async function invokeClaudeAgentViaCli(
  prompt: string,
  timeout: number = 30000
): Promise<string> {
  try {
    const result = execSync('claude', {
      input: prompt,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 20 * 1024 * 1024, // 20MB buffer for large responses
      stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr separately
    });

    return result.toString().trim();
  } catch (error) {
    const errorObj = error as { code?: string; signal?: string; message?: string; status?: number };

    // Handle timeout
    if (errorObj.code === 'ETIMEDOUT' || errorObj.message?.includes('ETIMEDOUT')) {
      throw new Error(`Claude CLI timeout after ${timeout}ms`);
    }

    // Handle command not found
    if (errorObj.code === 'ENOENT') {
      throw new Error(
        'Claude CLI not found. Ensure "claude" command is in PATH. ' +
        'Install Claude Code or add it to your PATH.'
      );
    }

    // Handle non-zero exit (agent execution error)
    if (errorObj.status && errorObj.status !== 0) {
      throw new Error(
        `Claude CLI exited with code ${errorObj.status}. ` +
        `${errorObj.message || 'No additional error message available'}`
      );
    }

    const msg = errorObj.message || String(error);
    throw new Error(`Failed to invoke Claude CLI: ${msg}`);
  }
}

export async function invokeClaudeAgent(
  state: WorkflowState,
  agentName: string,
  input: Record<string, unknown>,
  timeout: number = 30000
): Promise<AgentResponse> {
  try {
    console.debug(`[Agent] Invoking ${agentName}...`);

    // Load agent markdown
    const agentMarkdown = readAgentMarkdown(agentName);
    console.debug(`[Agent] Loaded ${agentName}.md (${agentMarkdown.instructions.length} chars)`);

    // Create prompt
    const prompt = createAgentPrompt(agentMarkdown, input);
    console.debug(`[Agent] Created prompt (${prompt.length} chars)`);

    // Invoke Claude via CLI (API method not implemented)
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
  timeoutSeconds: number = 30
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
