import * as path from 'path';
import * as fs from 'fs';
import { validateContract, normalizeResponse, stubPayload } from '../contracts';
import { AGENT_NAMES, STAGES, PHASE_ORDER, agentFilePath } from '../pipeline';
import { buildCliArgs, parseCliOutput } from '../claude-bridge';

describe('agent contracts', () => {
  it('accepts a conforming valid response', () => {
    const response = { phase: 'analyzer', valid: true, ...stubPayload('analyzer') };
    expect(validateContract(response, 'analyzer')).toEqual([]);
  });

  it('rejects a phase that does not match the agent', () => {
    const response = { phase: 'product-manager', valid: true, ...stubPayload('analyzer') };
    expect(validateContract(response, 'analyzer').join()).toMatch(/phase/);
  });

  it('rejects valid=true without the required payload', () => {
    const errors = validateContract({ phase: 'analyzer', valid: true }, 'analyzer');
    expect(errors.join()).toMatch(/analysis/);
  });

  it('requires an error or blockers when valid=false', () => {
    expect(validateContract({ phase: 'analyzer', valid: false }, 'analyzer')).not.toEqual([]);
    expect(validateContract({ phase: 'analyzer', valid: false, error: '  ' }, 'analyzer')).not.toEqual([]);
    expect(validateContract({ phase: 'analyzer', valid: false, error: 'boom' }, 'analyzer')).toEqual([]);
    expect(
      validateContract({ phase: 'analyzer', valid: false, blockers: [{ error: 'x' }] }, 'analyzer')
    ).toEqual([]);
  });

  it('only checks the envelope for unregistered agents', () => {
    expect(validateContract({ phase: 'custom', valid: true }, 'custom')).toEqual([]);
  });

  it('folds payload keys into output and an artifact', () => {
    const normalized = normalizeResponse(
      { phase: 'analyzer', valid: true, analysis: { name: 'x' } } as any,
      'analyzer'
    );
    expect(normalized.output).toEqual({ analysis: { name: 'x' } });
    expect(normalized.artifacts).toEqual([{ type: 'analyzer-output', content: { analysis: { name: 'x' } } }]);
  });

  it('keeps explicit output and artifacts', () => {
    const response = { phase: 'x', valid: true, output: { a: 1 }, artifacts: [{ type: 't', content: {} }], extra: 1 };
    const normalized = normalizeResponse(response as any, 'x');
    expect(normalized.output).toEqual({ a: 1 });
    expect(normalized.artifacts).toHaveLength(1);
  });
});

describe('pipeline registry drift', () => {
  it.each(AGENT_NAMES)('%s has an agent file', agent => {
    expect(fs.existsSync(agentFilePath(agent))).toBe(true);
  });

  it('stages cover every registered agent exactly once', () => {
    expect([...PHASE_ORDER].sort()).toEqual([...AGENT_NAMES].sort());
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
    expect(STAGES.every(s => s.agents.length > 0)).toBe(true);
  });

  // The documented "Output Format" example of each agent must satisfy its own contract.
  it.each(AGENT_NAMES)('%s documented output example satisfies its contract', agent => {
    const md = fs.readFileSync(agentFilePath(agent), 'utf-8');
    const section = md.slice(md.indexOf('## Output Format'));
    const match = section.match(/```json\s*([\s\S]*?)```/);
    expect(match).not.toBeNull();
    const example = JSON.parse(match![1]);
    expect(validateContract(example, agent)).toEqual([]);
  });
});

describe('claude CLI bridge', () => {
  it('runs headless without tools or session persistence', () => {
    const args = buildCliArgs();
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
  });

  it('unwraps the result field', () => {
    expect(parseCliOutput(JSON.stringify({ result: ' {"a":1} ', is_error: false }))).toBe('{"a":1}');
  });

  it('throws when the CLI reports an error', () => {
    expect(() => parseCliOutput(JSON.stringify({ result: 'no access', is_error: true }))).toThrow(/no access/);
  });

  it('passes through non-JSON output', () => {
    expect(parseCliOutput('plain text\n')).toBe('plain text');
  });
});

describe('documentation drift', () => {
  const root = path.join(__dirname, '..', '..');
  const scripts: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf-8')
  ).scripts;
  const builtins = new Set(['install', 'ci', 'start', 'test', 'init', 'audit']);
  const docs = [
    'README.md', 'QUICKSTART.md', 'CONTRIBUTING.md', '.claude/CLAUDE.md',
    'docs/CONFIGURATION.md', 'docs/ORCHESTRATION.md'
  ];

  it.each(docs)('%s only references npm scripts that exist', doc => {
    const text = fs.readFileSync(path.join(root, doc), 'utf-8');
    const missing = new Set<string>();
    for (const match of text.matchAll(/npm run ([\w:-]+)/g)) {
      if (!builtins.has(match[1]) && !scripts[match[1]]) missing.add(match[1]);
    }
    expect([...missing]).toEqual([]);
  });

  it('CLAUDE.md names every registered agent', () => {
    const text = fs.readFileSync(path.join(root, '.claude', 'CLAUDE.md'), 'utf-8');
    for (const agent of AGENT_NAMES) {
      expect(text).toContain(`${agent}.md`);
    }
  });
});
