#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  loadWorkflowState,
  listWorkflowStates,
  readSnapshot,
  WorkflowState,
  saveWorkflowState,
  writeSnapshot
} from './state';
import { describeEvent, readEvents, replay, stateDifferences } from './events';
import { FactoryOrchestrator } from './orchestrator';
import { invokeClaudeAgent } from './claude-bridge';
import { AgentName, isAgentName } from './pipeline';
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

async function cmdReplay(workflowId: string, write: boolean): Promise<void> {
  const { events, unreadable } = readEvents(workflowId);
  if (events.length === 0) {
    console.error(chalk.red(`✗ No event log for ${workflowId} (workflows/${workflowId}.events.jsonl)`));
    process.exit(1);
  }
  printHeader(`Events for ${workflowId}`);
  for (const ev of events) console.log(`${String(ev.seq).padStart(4)}  ${ev.at}  ${describeEvent(ev)}`);
  if (unreadable > 0) console.log(chalk.yellow(`\n${unreadable} unreadable line(s) were skipped (a write cut short).`));

  const rebuilt = replay(events);
  const saved = readSnapshot(workflowId);
  if (!rebuilt) {
    console.error(chalk.red('✗ The log has no starting event'));
    process.exit(1);
  }
  const differences = saved ? stateDifferences(rebuilt, saved) : ['(no snapshot)'];
  if (differences.length === 0) {
    console.log(chalk.green(`\n✓ The log replays to the saved state (${events.length} events)`));
    return;
  }
  console.log(chalk.yellow(`\nThe log and the saved state differ in: ${differences.join(', ')}`));
  if (write) {
    writeSnapshot(rebuilt);
    console.log(chalk.green('✓ The saved state was rewritten from the log'));
  } else {
    console.log(chalk.gray(`  Rewrite the saved state from the log with: factory replay ${workflowId} --write`));
  }
}

async function cmdRetry(workflowId: string, until?: AgentName): Promise<void> {
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
    state,
    { until }
  );

  printWorkflowDetail(finalState);
  console.log(chalk.green(`✓ Retry completed: ${finalState.id}`));
}

async function cmdAnswer(workflowId: string, answerText: string, until?: AgentName): Promise<void> {
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
    answered,
    { until }
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
          console.error(chalk.red('Usage: factory retry <workflow-id> [--until <agent>]'));
          process.exit(1);
        }
        {
          const trailing = args.length === 4 && args[2] === '--until' && isAgentName(args[3]);
          await cmdRetry(args[1], trailing ? (args[3] as AgentName) : undefined);
        }
        break;

      case 'replay':
        if (args.length < 2) {
          console.error(chalk.red('Usage: factory replay <workflow-id> [--write]'));
          process.exit(1);
        }
        await cmdReplay(args[1], args.includes('--write'));
        break;

      case 'answer':
        if (args.length < 3) {
          console.error(chalk.red('Usage: factory answer <workflow-id> <answer> [--until <agent>]'));
          process.exit(1);
        }
        {
          // The flag counts only at the very end and only with a real agent name, so a person's answer is never cut up.
          const trailing = args.length >= 5 && args[args.length - 2] === '--until' && isAgentName(args[args.length - 1]);
          const rest = trailing ? args.slice(0, -2) : args;
          await cmdAnswer(rest[1], rest.slice(2).join(' '), trailing ? (args[args.length - 1] as AgentName) : undefined);
        }
        break;

      default:
        console.error(chalk.red(`Unknown command: ${command}`));
        console.error(chalk.gray('\nUsage:'));
        console.error(chalk.gray('  factory start <brief> [issue-number] [--until <agent>]'));
        console.error(chalk.gray('  factory status <workflow-id>'));
        console.error(chalk.gray('  factory list'));
        console.error(chalk.gray('  factory watch <workflow-id>'));
        console.error(chalk.gray('  factory retry <workflow-id> [--until <agent>]'));
        console.error(chalk.gray('  factory answer <workflow-id> <answer> [--until <agent>]'));
        console.error(chalk.gray('  factory replay <workflow-id> [--write]'));
        process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`\n✗ Error: ${error}`));
    process.exit(1);
  }
})();
