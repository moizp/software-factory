#!/usr/bin/env node
import { evaluatePolicy, loadPolicy, prInfoFromGit } from './policy-engine';

// Usage: policy-cli --base <ref> --head <ref> --branch <name> [--labels a,b] [--policy-ref <ref>]
// The policy is read from --policy-ref (default: --base), never from the PR head.

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = arg('base');
const head = arg('head');
const branch = arg('branch');

if (!base || !head || !branch) {
  console.error('Usage: policy-cli --base <ref> --head <ref> --branch <name> [--labels a,b] [--policy-ref <ref>]');
  process.exit(2);
}

const labels = (arg('labels') ?? '').split(',').filter(Boolean);
const policy = loadPolicy(arg('policy-ref') ?? base);
const info = prInfoFromGit(base, head, branch, labels);
const decision = evaluatePolicy(policy, info);

console.log(JSON.stringify({ ...decision, files: info.files.length, changedLines: info.changedLines }, null, 2));
