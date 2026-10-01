#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { FactoryOrchestrator, mockAgentInvoker } from './orchestrator';
import { saveWorkflowState } from './state';

async function main() {
  const issueBrief = process.env.ISSUE_TITLE || '';
  const issueNumber = process.env.ISSUE_NUMBER ? parseInt(process.env.ISSUE_NUMBER, 10) : undefined;
  const githubToken = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!issueBrief) {
    console.error('Error: ISSUE_TITLE environment variable not set');
    process.exit(1);
  }

  if (!githubToken) {
    console.error('Error: GITHUB_TOKEN environment variable not set');
    process.exit(1);
  }

  // Load project config
  let config: Record<string, unknown> = {};
  const configPath = path.join(process.cwd(), 'project.config.json');
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
      console.warn(`Warning: Failed to parse project.config.json: ${error}`);
    }
  }

  console.log(`[Workflow] Starting orchestrator with brief: "${issueBrief}"`);
  console.log(`[Workflow] Issue #${issueNumber}, Owner: ${owner}, Repo: ${repo}`);

  try {
    // Create orchestrator with real agent invoker
    const orchestrator = new FactoryOrchestrator(
      mockAgentInvoker,
      true,
      githubToken,
      { maxRetries: 3, backoffMs: 1000 }
    );

    // Execute workflow
    const finalState = await orchestrator.executeWorkflow(
      issueBrief,
      issueNumber,
      config
    );

    // Save state
    saveWorkflowState(finalState);

    // Output workflow state as JSON for GitHub Actions
    console.log('\n[Workflow Output]');
    console.log(JSON.stringify({
      workflowId: finalState.id,
      status: finalState.status,
      issueNumber: finalState.issueNumber,
      phases: finalState.phases.map(p => ({
        phase: p.phase,
        valid: p.valid,
        error: p.error
      }))
    }, null, 2));

    // Set exit code based on workflow status
    if (finalState.status === 'completed') {
      console.log('[Workflow] Orchestration completed successfully');
      process.exit(0);
    } else if (finalState.status === 'failed') {
      console.error('[Workflow] Orchestration failed');
      process.exit(1);
    } else {
      console.warn(`[Workflow] Orchestration ended with status: ${finalState.status}`);
      process.exit(1);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Workflow] Fatal error: ${errorMsg}`);
    console.error(error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`[Workflow] Uncaught error: ${error}`);
  process.exit(1);
});
