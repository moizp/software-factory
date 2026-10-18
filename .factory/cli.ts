#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  loadWorkflowState,
  listWorkflowStates,
  WorkflowState,
  saveWorkflowState
} from './state';
import { FactoryOrchestrator } from './orchestrator';
import { invokeClaudeAgent } from './claude-bridge';
import { AgentName } from './pipeline';
import { pendingExchange, recordAnswer, renderQuestion, validateAnswer } from './human';

function printHeader(text: string): void {
  console.log(chalk.bold.blue(`\n╔ ${text}`));
  console.log(chalk.blue('║'));
}

function printStatus(status: string, value: string): void {
  const colors: Record<string, (s: string) => string> = {
    running: chalk.yellow,
    completed: chalk.green,
    failed: chalk.red,
    paused: chalk.gray
  };
  const colorFn = colors[value] || chalk.white;
  console.log(chalk.blue('║') + ` ${status}: ${colorFn(value)}`);
}

function printWorkflowDetail(state: WorkflowState): void {
  console.log(chalk.blue('║'));
  printStatus('Status', state.status);
  printStatus('Current Phase', state.currentPhase);
  console.log(chalk.blue('║') + ` Issue #${state.issueNumber || 'N/A'}`);
  console.log(chalk.blue('║') + ` Started: ${state.startedAt}`);
  console.log(chalk.blue('║') + ` Updated: ${state.updatedAt}`);

  if (state.phases.length > 0) {
    console.log(chalk.blue('║'));
    console.log(chalk.blue('║') + chalk.bold(' Phases:'));
    for (const phase of state.phases) {
      const mark = phase.valid ? chalk.green('✓') : chalk.red('✗');
      console.log(chalk.blue('║') + `  ${mark} ${phase.phase} (${phase.timestamp})`);
      if (phase.error) {
        console.log(chalk.blue('║') + chalk.red(`    Error: ${phase.error}`));
      }
    }
  }

  const waiting = pendingExchange(state.humanRequests);
  if (waiting) {
    console.log(chalk.blue('║'));
    console.log(chalk.blue('║') + chalk.bold.yellow(' Waiting for a person:'));
    renderQuestion(waiting, state.id).split('\n').forEach(line => console.log(chalk.blue('║') + `  ${line}`));
    console.log(chalk.blue('║') + chalk.gray(`  Answer with: factory answer ${state.id} "<answer>"`));
  }

  if (state.notes.length > 0) {
    console.log(chalk.blue('║'));
    console.log(chalk.blue('║') + chalk.bold(' Notes:'));
    for (const note of state.notes.slice(-5)) {
      console.log(chalk.blue('║') + `  ${note}`);
    }
  }

  console.log(chalk.blue('║'));
  console.log(chalk.blue('╚'));
}

async function cmdStart(issueBrief: string, issueNumber?: number, until?: AgentName): Promise<void> {
  printHeader('Starting Factory Workflow');

  const orchestrator = new FactoryOrchestrator(invokeClaudeAgent, true);
  const finalState = await orchestrator.executeWorkflow(
    issueBrief,
    issueNumber,
    undefined,
    undefined,
    { until }
  );

  printWorkflowDetail(finalState);
  console.log(chalk.green(`\n✓ Workflow ${finalState.id} ${finalState.status}`));
  console.log(chalk.gray(`  Tokens used: ${finalState.tokensUsed ?? 0}`));
}

async function cmdStatus(workflowId: string): Promise<void> {
  const state = loadWorkflowState(workflowId);

  if (!state) {
    console.error(chalk.red(`✗ Workflow not found: ${workflowId}`));
    process.exit(1);
  }

  printHeader(`Workflow Status: ${state.id}`);
  printWorkflowDetail(state);
}

async function cmdList(): Promise<void> {
  const workflows = listWorkflowStates();

  if (workflows.length === 0) {
    console.log(chalk.yellow('No workflows found'));
    return;
  }

  printHeader('Active Workflows');

  for (const workflow of workflows) {
    const statusColor = workflow.status === 'completed' ? chalk.green :
                       workflow.status === 'failed' ? chalk.red :
                       chalk.yellow;

    console.log(chalk.blue('║') + ` ${workflow.id}`);
    console.log(chalk.blue('║') + `  Status: ${statusColor(workflow.status)}`);
    console.log(chalk.blue('║') + `  Phase: ${workflow.currentPhase}`);
    console.log(chalk.blue('║') + `  Issue: #${workflow.issueNumber || 'N/A'}`);
    console.log(chalk.blue('║'));
  }

  console.log(chalk.blue('╚'));
}

async function cmdWatch(workflowId: string, interval: number = 5000): Promise<void> {
  let lastUpdated = '';
  let failureNotified = false;

  const checkStatus = async () => {
    const state = loadWorkflowState(workflowId);

    if (!state) {
      if (!failureNotified) {
        console.error(chalk.red(`✗ Workflow not found: ${workflowId}`));
        failureNotified = true;
      }
      return;
    }

    const updated = state.updatedAt;
    if (updated !== lastUpdated) {
      console.clear();
      printHeader(`Watching Workflow: ${state.id}`);
      printWorkflowDetail(state);
      lastUpdated = updated;

      if (state.status === 'completed' || state.status === 'failed') {
        console.log(chalk.green(`Workflow ${state.status}`));
        process.exit(state.status === 'completed' ? 0 : 1);
      }
    }
  };

  console.log(chalk.blue(`Watching workflow ${workflowId}...`));
  await checkStatus();

  const timer = setInterval(checkStatus, interval);

  process.on('SIGINT', () => {
    clearInterval(timer);
    process.exit(0);
  });
}

async function cmdRetry(workflowId: string): Promise<void> {
  const state = loadWorkflowState(workflowId);

  if (!state) {
    console.error(chalk.red(`✗ Workflow not found: ${workflowId}`));
    process.exit(1);
  }

  if (state.status === 'completed') {
    console.warn(chalk.yellow(`Workflow ${workflowId} already completed`));
    return;
  }

  const waiting = pendingExchange(state.humanRequests);
  if (waiting) {
    console.error(chalk.red(`✗ Workflow ${workflowId} is waiting for an answer to: ${waiting.request.question}`));
    console.error(chalk.gray(`  Answer it with: factory answer ${workflowId} "<answer>"`));
    process.exit(1);
  }

  const failedGates = state.phases.filter(p => !p.valid);
  const failedPhase = failedGates[failedGates.length - 1]?.phase ?? state.currentPhase;

  printHeader(`Resuming ${state.id} from: ${failedPhase}`);

  // Resume the same workflow: validated phases are kept, failed ones re-run
  const orchestrator = new FactoryOrchestrator(invokeClaudeAgent, true);
  const finalState = await orchestrator.executeWorkflow(
    state.issueBrief,
    state.issueNumber,
    state.config,
    state
  );

  printWorkflowDetail(finalState);
  console.log(chalk.green(`✓ Retry completed: ${finalState.id}`));
}

async function cmdAnswer(workflowId: string, answerText: string): Promise<void> {
  const state = loadWorkflowState(workflowId);

  if (!state) {
    console.error(chalk.red(`✗ Workflow not found: ${workflowId}`));
    process.exit(1);
  }

  const waiting = pendingExchange(state.humanRequests);
  if (!waiting) {
    console.error(chalk.red(`✗ Workflow ${workflowId} is not waiting for an answer`));
    process.exit(1);
  }

  const checked = validateAnswer(waiting.request, answerText);
  if (!checked.ok) {
    console.error(chalk.red(`✗ ${checked.error}`));
    console.error(renderQuestion(waiting, workflowId));
    process.exit(1);
  }

  const updated = recordAnswer(state.humanRequests, checked.value, process.env.FACTORY_ANSWER_BY);
  const answered = { ...state, humanRequests: updated ?? state.humanRequests };
  saveWorkflowState(answered);
  printHeader(`Answer recorded for ${state.id}: ${checked.value}`);

  // The phase that asked runs again with the answer; completed phases are kept
  const orchestrator = new FactoryOrchestrator(invokeClaudeAgent, true);
  const finalState = await orchestrator.executeWorkflow(
    answered.issueBrief,
    answered.issueNumber,
    answered.config,
    answered
  );

  printWorkflowDetail(finalState);
  console.log(chalk.green(`✓ Workflow ${finalState.id} ${finalState.status}`));
}

const args = process.argv.slice(2);
const command = args[0];

(async () => {
  try {
    switch (command) {
      case 'start':
        if (args.length < 2) {
          console.error(chalk.red('Usage: factory start <brief> [issue-number] [--until <agent>]'));
          process.exit(1);
        }
        {
          const untilIdx = args.indexOf('--until');
          const until = untilIdx >= 0 ? (args[untilIdx + 1] as AgentName) : undefined;
          const rest = untilIdx >= 0 ? args.filter((_, i) => i !== untilIdx && i !== untilIdx + 1) : args;
          const issue = rest[2] && /^\d+$/.test(rest[2]) ? parseInt(rest[2], 10) : undefined;
          if (!rest[1] || rest[1].startsWith('--')) {
            console.error(chalk.red('Usage: factory start <brief> [issue-number] [--until <agent>]'));
            process.exit(1);
          }
          await cmdStart(rest[1], issue, until);
        }
        break;

      case 'status':
        if (args.length < 2) {
          console.error(chalk.red('Usage: factory status <workflow-id>'));
          process.exit(1);
        }
        await cmdStatus(args[1]);
        break;

      case 'list':
        await cmdList();
        break;

      case 'watch':
        if (args.length < 2) {
          console.error(chalk.red('Usage: factory watch <workflow-id>'));
          process.exit(1);
        }
        await cmdWatch(args[1], args[2] ? parseInt(args[2], 10) : 5000);
        break;

      case 'retry':
        if (args.length < 2) {
          console.error(chalk.red('Usage: factory retry <workflow-id>'));
          process.exit(1);
        }
        await cmdRetry(args[1]);
        break;

      case 'answer':
        if (args.length < 3) {
          console.error(chalk.red('Usage: factory answer <workflow-id> <answer>'));
          process.exit(1);
        }
        await cmdAnswer(args[1], args.slice(2).join(' '));
        break;

      default:
        console.error(chalk.red(`Unknown command: ${command}`));
        console.error(chalk.gray('\nUsage:'));
        console.error(chalk.gray('  factory start <brief> [issue-number] [--until <agent>]'));
        console.error(chalk.gray('  factory status <workflow-id>'));
        console.error(chalk.gray('  factory list'));
        console.error(chalk.gray('  factory watch <workflow-id>'));
        console.error(chalk.gray('  factory retry <workflow-id>'));
        console.error(chalk.gray('  factory answer <workflow-id> <answer>'));
        process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`\n✗ Error: ${error}`));
    process.exit(1);
  }
})();
