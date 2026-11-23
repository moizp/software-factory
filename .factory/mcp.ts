import * as fs from 'fs';
import * as path from 'path';
import { Stack } from './stack';

/**
 * Which MCP servers a project should use, decided by its stack. A server is a tool an agent can call (documentation,
 * a code checker, a browser), so the right one for the framework beats the model's memory. Registry, `.mcp.json`
 * rendering and a check live here; nothing in this module runs a server.
 *
 * Today the pipeline's agents run headless without tools, so they are told which servers apply but cannot call them.
 * Interactive Claude Code sessions use `.mcp.json`, and builders with tools (change mode, F6 and T1) will too.
 */

export interface McpServer {
  id: string;
  /** What it is for, in a line. */
  purpose: string;
  /** Whether a project of this stack must have it, or it is only suggested. */
  level: 'required' | 'optional';
  applies(stack: Stack): boolean;
  /** How Claude Code starts it. Versions are pinned so a bump is a reviewed change. */
  transport: { type: 'stdio'; command: string; args: string[] } | { type: 'http'; url: string };
  tools: string[];
  /** The instruction the agents and the project CLAUDE.md carry for it. */
  use: string;
  /** What leaves the machine when it is used. */
  note: string;
}

const isSvelte = (s: Stack): boolean => /^(sveltekit|svelte)$/i.test(s.frontend.framework ?? '');

export const SVELTE_MCP_VERSION = '0.1.31';
export const PLAYWRIGHT_MCP_VERSION = '0.0.86';

export const REGISTRY: McpServer[] = [
  {
    id: 'svelte',
    purpose: 'Official Svelte and SvelteKit documentation, and a static checker for Svelte code',
    level: 'required',
    applies: isSvelte,
    transport: { type: 'stdio', command: 'npx', args: ['-y', `@sveltejs/mcp@${SVELTE_MCP_VERSION}`] },
    tools: ['list-sections', 'get-documentation', 'svelte-autofixer', 'playground-link'],
    use: 'Before using a Svelte or SvelteKit API (runes, load functions, forms, hooks, routing), call get-documentation instead of recalling it; run svelte-autofixer on every .svelte and .svelte.ts file you write and fix what it reports until it reports nothing.',
    note: 'The local server runs on the machine; only documentation is fetched from svelte.dev. The hosted server (https://mcp.svelte.dev/mcp) is not used by default because it receives the code it checks.'
  },
  {
    id: 'playwright',
    purpose: 'Drives a real browser against the running app, to explore, debug and check a change',
    level: 'optional',
    applies: isSvelte,
    transport: { type: 'stdio', command: 'npx', args: [`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, '--headless'] },
    tools: [],
    use: 'To see how a change behaves in the browser, start the app (npm run dev) and use the browser tools; the before and after pictures for a pull request still come from npm run evidence:capture, not from here.',
    note: 'Runs a local browser; it can open any URL you point it at.'
  }
];

export const serversFor = (stack: Stack): McpServer[] => REGISTRY.filter(s => s.applies(stack));

/** What the agents are told: which servers apply, their tools, and how to use them. */
export function mcpForAgents(stack: Stack): Array<{ id: string; level: string; tools: string[]; use: string }> {
  return serversFor(stack).map(s => ({ id: s.id, level: s.level, tools: s.tools, use: s.use }));
}

/** The content of a project's `.mcp.json`. */
export function renderMcpJson(servers: McpServer[]): string {
  const entries = Object.fromEntries(servers.map(s => [s.id, s.transport.type === 'stdio'
    ? { type: 'stdio', command: s.transport.command, args: s.transport.args }
    : { type: 'http', url: s.transport.url }]));
  return JSON.stringify({ mcpServers: entries }, null, 2) + '\n';
}

/** The `claude mcp add` command for a server, at project scope so it is shared through `.mcp.json`. */
export function addCommand(s: McpServer): string {
  return s.transport.type === 'stdio'
    ? `claude mcp add -t stdio -s project ${s.id} -- ${s.transport.command} ${s.transport.args.join(' ')}`
    : `claude mcp add -t http -s project ${s.id} ${s.transport.url}`;
}

export interface McpReport {
  /** False when the project is not a SvelteKit app, so there is nothing to check. */
  applicable: boolean;
  missingRequired: string[];
  missingOptional: string[];
  /** Servers whose command is not the pinned one. */
  unpinned: string[];
}

/** Compares a project's `.mcp.json` with what its stack needs. */
export function checkMcp(root: string, stack: Stack): McpReport {
  let pkg: Record<string, any> | null = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')); } catch { /* none */ }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (!deps['@sveltejs/kit']) return { applicable: false, missingRequired: [], missingOptional: [], unpinned: [] };

  let configured: Record<string, any> = {};
  try { configured = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8')).mcpServers ?? {}; } catch { /* none */ }
  const wanted = serversFor(stack);
  const unpinned = wanted.filter(s => configured[s.id] && s.transport.type === 'stdio' && !(configured[s.id].args ?? []).some((a: unknown) => String(a).includes('@') && /@\d/.test(String(a)))).map(s => s.id);
  return {
    applicable: true,
    missingRequired: wanted.filter(s => s.level === 'required' && !configured[s.id]).map(s => s.id),
    missingOptional: wanted.filter(s => s.level === 'optional' && !configured[s.id]).map(s => s.id),
    unpinned
  };
}
