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
  // Try to extract JSON from the response
  // First, try to find a JSON code block
  const jsonCodeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonCodeBlockMatch) {
    try {
      return JSON.parse(jsonCodeBlockMatch[1]);
    } catch (e) {
      // Continue to other extraction methods
    }
  }

  // Try to find raw JSON object
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Continue
    }
  }

  throw new Error('Could not extract JSON from response');
}

function createAgentPrompt(
  agentMarkdown: AgentMarkdown,
  context: Record<string, unknown>
): string {
  const contextJson = JSON.stringify(context, null, 2);

  return `${agentMarkdown.instructions}

---

## INPUT CONTEXT (JSON)

\`\`\`json
${contextJson}
\`\`\`

---

Process this input according to your instructions and return ONLY the JSON output as specified in the "Output Format" section. Do not include any preamble or explanation, just the JSON.`;
}

async function invokeClaudeAgentViaApi(
  prompt: string,
  timeout: number = 30000
): Promise<string> {
  // This is a placeholder for API invocation
  // In production, this would call the Anthropic API
  // For now, we'll return an error
  throw new Error(
    'Direct API invocation not configured. Use CLI method instead.'
  );
}

async function invokeClaudeAgentViaCli(
  prompt: string,
  timeout: number = 30000
): Promise<string> {
  try {
    // Invoke claude CLI with input via stdin
    const result = execSync('claude', {
      input: prompt,
      encoding: 'utf-8',
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    return result;
  } catch (error) {
    // Check if it's a timeout error
    if (error instanceof Error && error.message.includes('ETIMEDOUT')) {
      throw new Error(`Claude CLI timeout after ${timeout}ms`);
    }

    throw new Error(
      `Failed to invoke Claude CLI: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function invokeClaudeAgent(
  state: WorkflowState,
  agentName: string,
  input: Record<string, unknown>,
  timeout: number = 30000
): Promise<AgentResponse> {
  try {
    // Load agent markdown
    const agentMarkdown = readAgentMarkdown(agentName);

    // Create prompt
    const prompt = createAgentPrompt(agentMarkdown, input);

    // Invoke Claude
    let response: string;
    try {
      response = await invokeClaudeAgentViaCli(prompt, timeout);
    } catch (e) {
      // Fallback to API (not implemented, will throw)
      response = await invokeClaudeAgentViaApi(prompt, timeout);
    }

    // Extract JSON from response
    const jsonOutput = extractJsonFromResponse(response);

    // Validate response structure
    if (!jsonOutput.phase || typeof jsonOutput.valid !== 'boolean') {
      throw new Error(
        'Invalid agent response: missing phase or valid field'
      );
    }

    return jsonOutput as AgentResponse;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

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
