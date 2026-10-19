import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stubPayload } from '../contracts';
import {
  AGENT_TERMS, MAX_TERMS, MIN_TERMS, languageForAgents, languageHits, loadLanguage, parseLanguage, renderLanguageLine, stringValues
} from '../language';
import { FactoryOrchestrator } from '../orchestrator';
import { retryConfig } from './fixtures';

const root = path.join(__dirname, '..', '..');
const skill = fs.readFileSync(path.join(root, '.claude', 'skills', 'ubiquitous-language.md'), 'utf-8');
const glossary = /```markdown\n([\s\S]*?)```/.exec(skill)![1];
const page = (rows: string, header = '| Term | Means | Avoid | Not to be confused with |\n|---|---|---|---|', status = 'current') =>
  `# Glossary\n\nStatus: ${status}\nLast verified: 2026-10-19\nSources: interviews\n\nThe words this project uses for its own things.\n\n## Terms\n\n${header}\n${rows}\n`;
const THREE = '| Invoice | A request for payment sent to a customer | bill, tab | Receipt |\n| Customer | A business that pays us for the product | client | User |\n| User | A person who signs in for a customer | member | Customer |';
const errors = (md: string) => { const r = parseLanguage(md); return r.ok ? [] : r.errors; };

describe('parseLanguage', () => {
  it('accepts the skill example and reads every column', () => {
    const r = parseLanguage(glossary);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.terms.map(t => t.term)).toEqual(['Invoice', 'Customer', 'User']);
      expect(r.terms[0]).toEqual({ term: 'Invoice', means: 'A request for payment that we send to a customer', avoid: ['bill', 'tab'], notConfusedWith: 'Receipt' });
      expect(renderLanguageLine(r.terms)).toBe('3 terms: Invoice, Customer, User');
    }
  });
  it('works without the optional columns, and finds the table by its header', () => {
    const md = page(THREE.replace(/ \| [^|]*\|$/gm, ' |'), '| Term | Means |\n|---|---|');
    const r = parseLanguage('# G\n\n' + md.split('## Terms')[1].replace(/\|[^|\n]*\|[^|\n]*\|\n/g, m => m));
    expect(typeof r.ok).toBe('boolean');
    expect(parseLanguage(page('| A | the first term in the list |\n| B | the second term in the list |\n| C | the third term in the list |', '| Term | Means |\n|---|---|')).ok).toBe(true);
  });
  it('needs the table, enough terms and not too many', () => {
    expect(errors('# Glossary\n\nno table')[0]).toContain('no "## Terms" table');
    expect(errors(page('| A | the first term in the list | | |\n| B | the second term in the list | | |'))).toEqual([`the glossary needs at least ${MIN_TERMS} terms, found 2`]);
    const many = Array.from({ length: MAX_TERMS + 1 }, (_, i) => `| Term${i}x | meaning of term number ${i} | | |`).join('\n');
    expect(errors(page(many)).join()).toContain(`has ${MAX_TERMS + 1} terms`);
  });
  it('wants one short meaning per term, defined once, plural or not', () => {
    expect(errors(page(THREE + '\n| Short | too short | | |')).join()).toContain('"Short" has no meaning, or one too short');
    expect(errors(page(THREE + `\n| Long | ${'x'.repeat(301)} | | |`)).join()).toContain('longer than 300 characters');
    expect(errors(page(THREE + '\n| Invoices | A second definition of the same word | | |')).join()).toContain('"Invoices" is defined twice (also as "Invoice")');
    expect(errors(page(THREE + '\n| | A meaning with no term at all | | |')).join()).toContain('a term is empty');
  });
  it('rejects a term that is also an avoid word, and an avoid word that belongs to two terms', () => {
    expect(errors(page(THREE.replace('bill, tab', 'bill, user'))).join()).toContain('"user" is both a term and a word to avoid for "Invoice"');
    expect(errors(page(THREE.replace('| client |', '| bill |'))).join()).toContain('"bill" is to be avoided for both "Invoice" and "Customer"');
  });
  it('warns when nothing can be checked for drift', () => {
    const r = parseLanguage(page(THREE.replace(/ \| (bill, tab|client|member) \|/g, ' |  |')));
    expect(r.ok && r.warnings.join()).toContain('no term lists a word to avoid');
    const some = parseLanguage(page(THREE.replace('| member |', '|  |')));
    expect(some.ok && some.warnings.join()).toContain('"User" lists no words to avoid');
  });
  it('rejects placeholders but ignores comments and code', () => {
    expect(errors(page(THREE + '\n| <Term> | <One sentence about it> | | |')).join()).toContain('template placeholders');
    expect(errors(`<!-- <x> -->${page(THREE)}`)).toEqual([]);
  });
  it('handles an escaped pipe in a cell', () => {
    const r = parseLanguage(page(THREE + '\n| Either | Means a or b, written a \\| b in prose | | |'));
    expect(r.ok && r.terms[3].means).toBe('Means a or b, written a | b in prose');
  });
});

describe('what agents receive', () => {
  it('has the meaning and the avoid words, and no more than the limit', () => {
    const r = parseLanguage(glossary);
    if (!r.ok) throw new Error('example');
    expect(languageForAgents(r.terms)[0]).toEqual({ term: 'Invoice', means: 'A request for payment that we send to a customer', avoid: ['bill', 'tab'] });
    const many = Array.from({ length: AGENT_TERMS + 10 }, (_, i) => ({ term: `T${i}`, means: 'm', avoid: [] }));
    expect(languageForAgents(many)).toHaveLength(AGENT_TERMS);
    expect(languageForAgents(many)[0]).toEqual({ term: 'T0', means: 'm' });
  });
});

describe('languageHits', () => {
  const terms = [{ term: 'Invoice', means: 'm', avoid: ['bill', 'tab'] }, { term: 'Customer', means: 'm', avoid: ['client'] }];
  it('finds avoided words in string values only, as whole words, ignoring case', () => {
    expect(stringValues({ a: 'x', b: ['y', { c: 'z' }], d: 5, bill: 'k' })).toEqual(['x', 'y', 'z', 'k']);
    const hits = languageHits({
      'product-manager': { features: [{ name: 'Send a Bill to the client', note: 'the client then pays' }], bill: 'key only' },
      'backend-engineer': { generated_files: [{ path: 'src/billing.ts', description: 'tablet layout, bill_id column' }] }
    }, terms);
    expect(hits).toEqual([
      { phase: 'product-manager', avoid: 'client', use: 'Customer', count: 2 },
      { phase: 'product-manager', avoid: 'bill', use: 'Invoice', count: 1 }
    ]);
  });
  it('finds a multi-word avoid and escapes regex characters', () => {
    const hits = languageHits({ x: { t: 'the (old) bill-of-sale form' } }, [{ term: 'Invoice', means: 'm', avoid: ['(old) bill', 'bill-of-sale'] }]);
    expect(hits.map(h => h.avoid).sort()).toEqual(['(old) bill', 'bill-of-sale']);
  });
  it('caps the list and finds nothing in clean work', () => {
    expect(languageHits({ x: 'all clear' }, terms)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ term: `T${i}`, means: 'm', avoid: [`w${i}`] }));
    expect(languageHits({ x: many.map((_, i) => `w${i}`).join(' ') }, many)).toHaveLength(30);
  });
});

describe('loading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-load-'));
  it('reports missing, draft and current glossaries', () => {
    expect(loadLanguage(path.join(dir, 'none.md'))).toEqual({ found: false });
    const draft = path.join(dir, 'draft.md'); fs.writeFileSync(draft, page(THREE, undefined, 'draft'));
    expect(loadLanguage(draft)).toMatchObject({ found: true, skipped: 'its Status is "draft", not "current"' });
    const cur = path.join(dir, 'cur.md'); fs.writeFileSync(cur, page(THREE));
    const l = loadLanguage(cur);
    expect('result' in l && l.result.ok).toBe(true);
    const nostatus = path.join(dir, 'ns.md'); fs.writeFileSync(nostatus, '# G\n\n## Terms\n');
    expect(loadLanguage(nostatus)).toMatchObject({ skipped: 'its Status is "missing", not "current"' });
  });
});

describe('the template', () => {
  const template = fs.readFileSync(path.join(root, 'templates', 'project', 'docs', 'wiki', 'glossary.md'), 'utf-8');
  it('is a draft, so the agents are not given its placeholder row', () => {
    expect(template).toContain('Status: draft');
    expect(parseLanguage(template).ok).toBe(false);
  });
});

describe('the CLI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-cli-'));
  const cli = path.join(root, '.factory', 'language-cli.ts');
  const run = (args: string[]) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), cli, ...args], { cwd: dir, encoding: 'utf-8' });
  it('checks a current glossary, skips a draft, fails a bad one and a missing one', () => {
    const good = path.join(dir, 'good.md'); fs.writeFileSync(good, glossary);
    expect(run(['check', good]).stdout).toContain('3 terms: Invoice, Customer, User');
    expect(JSON.parse(run(['check', good, '--json']).stdout)[0].term).toBe('Invoice');
    const draft = path.join(dir, 'draft.md'); fs.writeFileSync(draft, page(THREE, undefined, 'draft'));
    const d = run(['check', draft]); expect(d.status).toBe(0); expect(d.stdout).toContain('not used by the agents');
    const bad = path.join(dir, 'bad.md'); fs.writeFileSync(bad, page('| A | too short | | |'));
    const b = run(['check', bad]); expect(b.status).toBe(1); expect(b.stderr).toContain('cannot be used');
    expect(run(['check', path.join(dir, 'none.md')]).status).toBe(1);
    expect(run(['nonsense']).status).toBe(2);
  });
});

// ---- whole workflows -------------------------------------------------------------------------------------------------

describe('the orchestrator with a glossary', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 100, costUsd: 0, turns: 1 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'language-orch-'));
  const file = path.join(dir, 'glossary.md');
  const saved: Record<string, string | undefined> = {};
  const keys = ['FACTORY_LANGUAGE_FILE', 'FACTORY_REQUIRE_LANGUAGE', 'FACTORY_CHARACTER_FILE', 'FACTORY_LOOKFEEL_FILE', 'FACTORY_MISSION_FILE', 'FACTORY_DATA_DIR', 'FACTORY_IGNORE_WIP'];
  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(dir, 'data-'));
    process.env.FACTORY_IGNORE_WIP = '1';
    process.env.FACTORY_LANGUAGE_FILE = file;
    for (const k of ['CHARACTER', 'LOOKFEEL', 'MISSION']) process.env[`FACTORY_${k}_FILE`] = path.join(dir, `no-${k}.md`);
    delete process.env.FACTORY_REQUIRE_LANGUAGE;
    fs.writeFileSync(file, glossary);
  });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  function recorder(over: Record<string, (n: number) => Record<string, unknown>> = {}) {
    const calls: Array<{ agent: string; input: Record<string, any> }> = [];
    const invoker = (async (_s: any, agent: string, input: Record<string, any>) => {
      calls.push({ agent, input });
      const n = calls.filter(c => c.agent === agent).length;
      return { phase: agent, valid: true, ...stubPayload(agent), usage, ...(over[agent]?.(n) ?? {}) };
    }) as any;
    return { invoker, calls, of: (a: string) => calls.filter(c => c.agent === a) };
  }
  const orch = (invoker: any) => new FactoryOrchestrator(invoker, false, undefined, retryConfig);

  it('hands the terms to the agents that name things, and the avoided words used to the reviewer', async () => {
    const r = recorder({ 'backend-engineer': () => ({ generated_files: [{ path: 'src/bill.ts', description: 'sends the bill to the client' }] }) });
    const state = await orch(r.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'reviewer' });
    expect(state.language!.map(t => t.term)).toEqual(['Invoice', 'Customer', 'User']);
    expect(state.notes.some(n => n.includes('Language loaded: 3 terms'))).toBe(true);
    for (const a of ['product-manager', 'analyzer', 'software-architect', 'backend-engineer', 'frontend-engineer', 'reviewer']) expect(r.of(a)[0].input.language[0].term).toBe('Invoice');
    for (const a of ['infrastructure-engineer', 'automation-tester', 'e2e-tester']) expect(r.of(a)[0].input.language).toBeUndefined();
    const check = r.of('reviewer')[0].input.languageCheck.avoid_words_used;
    expect(check).toEqual(expect.arrayContaining([
      { phase: 'backend-engineer', avoid: 'bill', use: 'Invoice', count: expect.any(Number) },
      { phase: 'backend-engineer', avoid: 'client', use: 'Customer', count: 1 }
    ]));
    expect(r.of('product-manager')[0].input.languageCheck).toBeUndefined();
  });

  it('ignores a draft glossary, stops on an unusable current one, and stops on a missing one only when required', async () => {
    fs.writeFileSync(file, page(THREE, undefined, 'draft'));
    const draft = recorder();
    const s = await orch(draft.invoker).executeWorkflow('Build', 1, {}, undefined, { until: 'analyzer' });
    expect(s.status).not.toBe('failed');
    expect(s.language).toBeUndefined();
    expect(s.notes.some(n => n.includes('is not used: its Status is "draft"'))).toBe(true);
    expect(draft.of('product-manager')[0].input.language).toBeUndefined();

    fs.writeFileSync(file, page('| A | too short | | |'));
    const bad = recorder();
    const f = await orch(bad.invoker).executeWorkflow('Build', 2, {}, undefined, { until: 'analyzer' });
    expect(f.status).toBe('failed');
    expect(bad.calls).toHaveLength(0);

    fs.rmSync(file);
    const free = recorder();
    expect((await orch(free.invoker).executeWorkflow('Build', 3, {}, undefined, { until: 'analyzer' })).status).not.toBe('failed');
    process.env.FACTORY_REQUIRE_LANGUAGE = '1';
    const req = recorder();
    expect((await orch(req.invoker).executeWorkflow('Build', 4, {}, undefined, { until: 'analyzer' })).status).toBe('failed');
    fs.writeFileSync(file, page(THREE, undefined, 'draft'));
    expect((await orch(recorder().invoker).executeWorkflow('Build', 5, {}, undefined, { until: 'analyzer' })).status).toBe('failed');
  });
});
