import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { captureEvidence, playwrightShooter } from '../../evidence/capture';
import { parsePreview } from '../../evidence/checks';
import { pair } from '../../evidence/render';
import { Check, fail, pass, skip, warn } from '../types';

export const evidenceChecks: Check[] = [
  {
    id: 'project.preview',
    tier: 'offline',
    title: 'project.config.json says how to start the app for before and after pictures',
    run: ctx => {
      const file = path.join(ctx.projectDir, 'project.config.json');
      if (!fs.existsSync(file)) return skip('no project.config.json');
      let raw: any;
      try { raw = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return fail(`project.config.json is not valid JSON: ${(e as Error).message}`); }
      if (raw.preview === undefined) return skip('no "preview": a change to the interface cannot be photographed (fine for a project without one)', 'For a project with a UI add "preview": { "command": "npm run dev", "url": "http://localhost:3000" } to project.config.json');
      const p = parsePreview(raw.preview);
      return p.ok ? pass(`${p.value.command} at ${p.value.url}${p.value.ready_path}`) : fail(p.error, undefined, 'Fix "preview" in project.config.json (docs/GETTING-STARTED.md, section on pictures)');
    }
  },
  {
    id: 'offline.evidence',
    tier: 'offline',
    title: 'A real browser takes the same picture twice, and a changed page gives a different one',
    run: async () => {
      let shooter;
      try { shooter = playwrightShooter(process.cwd()); } catch (e) {
        return skip((e as Error).message.split('.')[0], 'For a project with a UI: `npm install -D playwright && npx playwright install chromium`; then this row proves pictures are repeatable');
      }
      await shooter.close();
      let colour = '#ffffff';
      const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><body style="margin:0;background:${colour}"><h1 id="t" style="padding:40px;font-family:sans-serif">Evidence</h1></body>`); });
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-verify-evidence-'));
      try {
        const opts = { cwd: out, preview: { command: '', url, ready_path: '/', timeout_s: 5 }, checks: [{ name: 'home', path: '/', widths: [375, 1280], wait_for: '#t' }], start: async () => () => {} };
        const a = await captureEvidence({ ...opts, label: 'before', outDir: path.join(out, 'a') });
        const b = await captureEvidence({ ...opts, label: 'before', outDir: path.join(out, 'b') });
        colour = '#ffe0e0';
        const c = await captureEvidence({ ...opts, label: 'after', outDir: path.join(out, 'c') });
        const repeat = pair(a, b).every(r => r.change === 'unchanged');
        const differs = pair(a, c).every(r => r.change === 'changed');
        if (!repeat) return fail('the same page gave different pictures twice: a difference between before and after would not mean the app changed', pair(a, b).map(r => `${r.check} ${r.width}: ${r.change}`).join('\n'), 'Paste this report; the capture settings need another fixed input');
        if (!differs) return fail('a changed page gave the same picture');
        return pass(`${a.shots.length} pictures, byte-identical on repeat, different after a change`);
      } catch (e) {
        return warn(`Playwright is installed but the browser could not take a picture: ${(e as Error).message.split('\n')[0]}`, undefined, 'Run `npx playwright install chromium`');
      } finally {
        server.close();
        fs.rmSync(out, { recursive: true, force: true });
      }
    }
  }
];
