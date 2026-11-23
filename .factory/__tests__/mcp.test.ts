import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { PLAYWRIGHT_MCP_VERSION, REGISTRY, SVELTE_MCP_VERSION, addCommand, checkMcp, mcpForAgents, renderMcpJson, serversFor } from '../mcp';
import { parseStack, stackForAgents } from '../stack';
import { runChecks } from '../verify';
import { webAppChecks } from '../verify/checks/css';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf-8');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
const put = (dir: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const svelte = parseStack({ frontend: { framework: 'sveltekit' } });
const react = parseStack({ frontend: { framework: 'react' } });

describe('which servers a stack calls for', () => {
  it('requires the Svelte MCP for Svelte and SvelteKit, and offers a browser', () => {
    expect(serversFor(svelte).map(s => `${s.id}:${s.level}`)).toEqual(['svelte:required', 'playwright:optional']);
    expect(serversFor(parseStack({ frontend: { framework: 'svelte' } })).map(s => s.id)).toContain('svelte');
    expect(serversFor(parseStack(undefined)).map(s => s.id)).toContain('svelte');
  });
  it('does not hand the Svelte server to another framework', () => {
    expect(serversFor(react)).toEqual([]);
    expect(stackForAgents(react).mcp_servers).toBeUndefined();
  });
  it('tells the agents each server\'s tools and how to use it', () => {
    const [first] = mcpForAgents(svelte);
    expect(first).toMatchObject({ id: 'svelte', level: 'required', tools: ['list-sections', 'get-documentation', 'svelte-autofixer', 'playground-link'] });
    expect(first.use).toContain('svelte-autofixer');
    expect(first.use).toContain('get-documentation');
    expect((stackForAgents(svelte).mcp_servers as unknown[]).length).toBe(2);
  });
  it('pins every server to an exact version and starts it locally', () => {
    for (const s of REGISTRY) {
      expect(s.transport.type).toBe('stdio');
      if (s.transport.type === 'stdio') expect(s.transport.args.some(a => /@\d+\.\d+\.\d+$/.test(a))).toBe(true);
    }
    expect(SVELTE_MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PLAYWRIGHT_MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('what is written for a project', () => {
  it('renders the .mcp.json the template ships and the command the docs give', () => {
    const required = serversFor(svelte).filter(s => s.level === 'required');
    expect(renderMcpJson(required)).toBe(read('templates', 'web-app', '.mcp.json'));
    expect(addCommand(required[0])).toBe(`claude mcp add -t stdio -s project svelte -- npx -y @sveltejs/mcp@${SVELTE_MCP_VERSION}`);
    expect(read('.claude', 'skills', 'mcp-setup.md')).toContain(addCommand(required[0]));
    expect(read('.claude', 'skills', 'mcp-setup.md')).toContain(addCommand(serversFor(svelte)[1]));
  });
  it('registers the same pinned version in the sample config, the setup script and the docs', () => {
    const cfg = JSON.parse(read('project.config.json'));
    expect(cfg.mcp_servers.svelte).toMatchObject({ type: 'stdio', required: true, command: 'npx', args: ['-y', `@sveltejs/mcp@${SVELTE_MCP_VERSION}`] });
    expect(cfg.mcp_servers.playwright.required).toBe(false);
    expect(read('scripts', 'setup-mcp.sh')).toContain(`claude mcp add -t stdio -s project svelte -- npx -y @sveltejs/mcp@${SVELTE_MCP_VERSION}`);
    expect(read('docs', 'CONFIGURATION.md')).toContain(`@sveltejs/mcp@${SVELTE_MCP_VERSION}`);
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts', 'setup-mcp.sh')]).status).toBe(0);
  });
  it('does not let the setup script stop at its first success (a counter that returns 1 under set -e)', () => {
    expect(read('scripts', 'setup-mcp.sh')).not.toMatch(/\(\(\s*SERVERS_\w+\+\+\s*\)\)/);
  });
});

describe('the agents are told to use them', () => {
  it('the frontend engineer looks documentation up and runs the autofixer, and records when it could not', () => {
    const t = read('.claude', 'agents', 'frontend-engineer.md');
    expect(t).toContain('`stack.mcp_servers`');
    expect(t).toContain('get-documentation');
    expect(t).toContain('svelte-autofixer');
    expect(t).toContain('"status": "not available"');
  });
  it('the analyzer lists the server, the configurator registers it, and the reviewer does not count unchecked Svelte as checked', () => {
    expect(read('.claude', 'agents', 'analyzer.md')).toContain('"svelte"');
    expect(read('.claude', 'agents', 'mcp-configurator.md')).toContain('claude mcp add -t stdio -s project svelte');
    const r = read('.claude', 'agents', 'reviewer.md');
    expect(r).toContain('svelte-autofixer');
    expect(r).toContain('review.not_verified');
  });
  it('a project CLAUDE.md template carries the rule for sessions', () => {
    expect(read('templates', 'project', 'CLAUDE.md')).toContain('.mcp.json');
  });
});

describe('checkMcp', () => {
  const app = (mcp?: object): string => {
    const dir = tmp();
    put(dir, 'package.json', JSON.stringify({ devDependencies: { '@sveltejs/kit': '^3.0.0' } }));
    if (mcp) put(dir, '.mcp.json', JSON.stringify(mcp));
    return dir;
  };
  const pinned = { type: 'stdio', command: 'npx', args: ['-y', `@sveltejs/mcp@${SVELTE_MCP_VERSION}`] };

  it('is not applicable to a project that is not a SvelteKit app', () => {
    expect(checkMcp(tmp(), svelte).applicable).toBe(false);
    expect(checkMcp(root, svelte).applicable).toBe(false);
  });
  it('wants the Svelte server, and mentions the optional one', () => {
    expect(checkMcp(app(), svelte)).toMatchObject({ applicable: true, missingRequired: ['svelte'], missingOptional: ['playwright'] });
    expect(checkMcp(app({ mcpServers: { svelte: pinned } }), svelte)).toMatchObject({ missingRequired: [], missingOptional: ['playwright'], unpinned: [] });
  });
  it('notices a server that is not pinned to a version', () => {
    const r = checkMcp(app({ mcpServers: { svelte: { type: 'stdio', command: 'npx', args: ['-y', '@sveltejs/mcp'] } } }), svelte);
    expect(r.unpinned).toEqual(['svelte']);
  });
  it('is the project.mcp row: skip, fail with the command, warn, then pass', async () => {
    const ctx = (projectDir: string) => ({ factoryRoot: root, projectDir, flags: { quick: true, live: false as const, github: false, createLabels: false, brief: 'b', tokenCap: 1 } });
    const row = async (dir: string) => (await runChecks(ctx(dir), webAppChecks.filter(c => c.id === 'project.mcp')))[0];
    expect((await row(tmp())).status).toBe('skip');
    const missing = await row(app());
    expect(missing.status).toBe('fail');
    expect(missing.extra).toContain('claude mcp add -t stdio -s project svelte');
    expect((await row(app({ mcpServers: { svelte: { type: 'stdio', command: 'npx', args: ['-y', '@sveltejs/mcp'] } } }))).status).toBe('warn');
    const ok = await row(app({ mcpServers: { svelte: pinned } }));
    expect(ok.status).toBe('pass');
    expect(ok.detail).toContain('svelte configured');
  });
});
