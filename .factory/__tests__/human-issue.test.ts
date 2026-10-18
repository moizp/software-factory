import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BOT_LOGIN, renderAnswerComment, renderQuestionComment, renderResumedComment } from '../route';
import { HumanExchange } from '../human';

/**
 * Runs the real route CLI (`answer`, `resume`) against a fake `gh` and a fake `npx`. The fakes answer from files and
 * record every call, so the tests see which comments were posted, which labels changed and what the pipeline was run with.
 */
const root = path.join(__dirname, '..', '..');
const tsNode = path.join(root, 'node_modules', '.bin', 'ts-node');

const exchange: HumanExchange = {
  id: 'analyzer-1', phase: 'analyzer', askedAt: '2026-10-18T10:00:00Z',
  request: { intent: 'choose', question: 'Which database?', urgency: 'high', format: 'multiple_choice', choices: ['Postgres', 'SQLite'] }
};

type Comment = { id: number; body: string; author: string };

function sandbox(opts: { comments: Comment[]; labels: string[]; permission?: string; artifact?: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-issue-'));
  const bin = path.join(dir, 'bin');
  const work = path.join(dir, 'work');
  fs.mkdirSync(bin);
  fs.mkdirSync(work);
  const log = path.join(dir, 'calls.log');
  const commentsFile = path.join(dir, 'comments.jsonl');
  fs.writeFileSync(commentsFile, opts.comments.map(c => JSON.stringify(c)).join('\n'));
  const issueJson = JSON.stringify({ number: 7, labels: opts.labels.map(name => ({ name })), author: { login: 'alice' }, body: 'Build a thing', title: 'A thing' });

  const write = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  write('gh', `
case "$*" in
  *"/permission"*) echo "${opts.permission ?? 'write'}" ;;
  "issue view"*) echo '${issueJson.replace(/'/g, "'\\''")}' ;;
  *"--paginate"*) cat "${commentsFile}" ;;
  "api repos/o/r/issues/7/comments"*) echo "POST $(cat | tr '\\n' '~')" >> "${log}"; echo 100 ;;
  "issue edit"*) echo "gh $*" >> "${log}" ;;
  "label create"*) ;;
  "workflow run"*) echo "gh $*" >> "${log}" ;;
  "run download"*)
    echo "gh $*" >> "${log}"
    ${opts.artifact === false ? 'exit 1' : 'dir=""; while [ $# -gt 0 ]; do [ "$1" = "-D" ] && dir="$2"; shift; done; mkdir -p "$dir/workflows"; echo "{}" > "$dir/workflows/wf-1.json"'} ;;
  *) echo "unexpected gh $*" >> "${log}"; exit 1 ;;
esac
`);
  write('npx', `echo "npx $(printf '[%s] ' "$@" | tr '\\n' '~')FACTORY_ANSWER_BY=$FACTORY_ANSWER_BY FACTORY_IGNORE_WIP=$FACTORY_IGNORE_WIP" >> "${log}"; exit \${CHILD_EXIT:-0}`);

  const run = (cmd: string, env: Record<string, string> = {}) =>
    spawnSync(tsNode, [path.join(root, '.factory', 'route', 'cli.ts'), cmd], {
      cwd: work,
      encoding: 'utf-8',
      env: {
        PATH: `${bin}:${process.env.PATH}`, HOME: dir, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', ISSUE_NUMBER: '7',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'), FACTORY_DATA_DIR: work, ...env
      }
    });
  return { run, work, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : []) };
}

const question = (): Comment => ({ id: 10, author: BOT_LOGIN, body: renderQuestionComment(exchange, 'wf-1', '99') });
const answerAs = (value: string): Comment => ({
  id: 20, author: BOT_LOGIN,
  body: renderAnswerComment({ workflow: 'wf-1', exchange: 'analyzer-1', run: '99', question: 'Which database?', value, by: 'alice' })
});
const answerEnv = (text: string, author = 'alice') => ({ COMMENT_AUTHOR: author, COMMENT_BODY: text });

describe('route-cli answer', () => {
  it('records a valid answer, requeues the issue and starts the router', () => {
    const s = sandbox({ comments: [question()], labels: ['needs-human', 'until:analyzer'] });
    const r = s.run('answer', answerEnv('/answer 2'));
    expect(r.status).toBe(0);
    const calls = s.calls();
    const post = calls.find(c => c.startsWith('POST'))!;
    expect(post).toContain('Answer from @alice');
    expect(post).toContain('SQLite');
    expect(calls).toContain('gh issue edit 7 --add-label agent:ready');
    expect(calls).toContain('gh issue edit 7 --remove-label needs-human');
    expect(calls).toContain('gh workflow run route.yml -f issue=7');
  });

  it('keeps the question open when the answer does not fit, and says why', () => {
    const s = sandbox({ comments: [question()], labels: ['needs-human'] });
    expect(s.run('answer', answerEnv('/answer Oracle')).status).toBe(0);
    const calls = s.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('Pick one of the options');
    expect(calls.some(c => c.includes('workflow run'))).toBe(false);
  });

  it('does nothing for someone without write access', () => {
    const s = sandbox({ comments: [question()], labels: ['needs-human'], permission: 'read' });
    expect(s.run('answer', answerEnv('/answer 1', 'mallory')).status).toBe(0);
    expect(s.calls()).toEqual([]);
  });

  it('says so when nothing is waiting, including after the answer was already given', () => {
    const none = sandbox({ comments: [], labels: ['needs-human'] });
    none.run('answer', answerEnv('/answer 1'));
    expect(none.calls()[0]).toContain('Nothing is waiting');

    const done = sandbox({ comments: [question(), answerAs('Postgres')], labels: ['needs-human'] });
    done.run('answer', answerEnv('/answer 2'));
    expect(done.calls()[0]).toContain('Nothing is waiting');
    expect(done.calls().some(c => c.includes('workflow run'))).toBe(false);
  });

  it('ignores a marker pasted by a person', () => {
    const forged: Comment = { id: 30, author: 'mallory', body: renderQuestionComment(exchange, 'evil', '1') };
    const s = sandbox({ comments: [forged], labels: ['needs-human'] });
    s.run('answer', answerEnv('/answer 1'));
    expect(s.calls()[0]).toContain('Nothing is waiting');
  });
});

describe('route-cli resume', () => {
  it('exits 3 when no answer is waiting', () => {
    for (const comments of [[], [question()], [question(), answerAs('Postgres'), { id: 30, author: BOT_LOGIN, body: renderResumedComment({ exchange: 'analyzer-1' }) }]]) {
      const s = sandbox({ comments, labels: ['agent:working'] });
      expect(s.run('resume').status).toBe(3);
      expect(s.calls().some(c => c.startsWith('npx'))).toBe(false);
    }
  });

  it('restores the saved state and answers the paused workflow, then marks the answer used', () => {
    const s = sandbox({ comments: [question(), answerAs('Postgres')], labels: ['agent:working', 'until:analyzer'] });
    const r = s.run('resume');
    expect(r.status).toBe(0);
    const calls = s.calls();
    expect(calls.find(c => c.startsWith('gh run download'))).toContain('run download 99 -n workflow-state-issue-7-99');
    const npx = calls.find(c => c.startsWith('npx'))!;
    expect(npx).toContain('[ts-node]');
    expect(npx).toContain('[answer] [wf-1] [Postgres] [--until] [analyzer]');
    expect(npx).toContain('FACTORY_ANSWER_BY=alice FACTORY_IGNORE_WIP=1');
    expect(fs.existsSync(path.join(s.work, 'workflows', 'wf-1.json'))).toBe(true);
    expect(calls.find(c => c.startsWith('POST'))).toContain('The answer to question `analyzer-1` was used');
  });

  it('starts again with the answer in the brief when the saved state is gone', () => {
    const s = sandbox({ comments: [question(), answerAs('Postgres')], labels: ['agent:working'], artifact: false });
    expect(s.run('resume').status).toBe(0);
    const npx = s.calls().find(c => c.startsWith('npx'))!;
    expect(npx).toContain('[start]');
    expect(npx).toContain('Answer: Postgres');
    expect(npx).toContain('[7] [--until] [software-architect]');
  });

  it('leaves the answer unused when the pipeline fails, so a retry resumes again', () => {
    const s = sandbox({ comments: [question(), answerAs('Postgres')], labels: ['agent:working'] });
    const r = s.run('resume', { CHILD_EXIT: '1' });
    expect(r.status).toBe(1);
    expect(s.calls().some(c => c.startsWith('POST'))).toBe(false);
  });
});
