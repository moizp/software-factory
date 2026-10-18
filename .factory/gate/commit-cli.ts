#!/usr/bin/env node
import { lintCommitMessage, renderCommitReport } from './commit-lint';

// Usage: commit-cli "<message>"   (exit 1 on errors; warnings are printed and allowed)
const message = process.argv.slice(2).join(' ');
const report = lintCommitMessage(message);
console.log(renderCommitReport(report));
process.exit(report.errors.length > 0 ? 1 : 0);
