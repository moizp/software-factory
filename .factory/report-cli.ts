#!/usr/bin/env node
import { listWorkflowStates } from './state';
import { measurePrompts, renderPromptReport, renderUsageReport, usageByAgent } from './prompts';

// Usage: report-cli prompts | usage
//   prompts  size of each agent prompt against its budget (exit 1 when one is over)
//   usage    real token use per agent from the saved workflow states
const cmd = process.argv[2];
if (cmd === 'prompts') {
  const rows = measurePrompts();
  console.log(renderPromptReport(rows));
  process.exit(rows.some(r => r.over) ? 1 : 0);
} else if (cmd === 'usage') {
  console.log(renderUsageReport(usageByAgent(listWorkflowStates())));
} else {
  console.error('Usage: report-cli prompts | usage');
  process.exit(2);
}
