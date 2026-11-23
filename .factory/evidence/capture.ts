import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { Preview, VisualCheck, shotFile } from './checks';

export type Label = 'before' | 'after';

export interface Shot {
  check: string;
  width: number;
  file: string;
  sha256: string;
}

export interface Manifest {
  version: 1;
  label: Label;
  commit: string;
  createdAt: string;
  shots: Shot[];
}

/** Takes one picture. The default drives Chromium through the project's own Playwright; tests pass their own. */
export interface Shooter {
  shoot(url: string, check: VisualCheck, width: number, file: string): Promise<void>;
  close(): Promise<void>;
}

export interface CaptureOptions {
  cwd: string;
  preview: Preview;
  checks: VisualCheck[];
  label: Label;
  /** The label's own directory is created inside it: <outDir>/<label>/ */
  outDir: string;
  shooter?: Shooter;
  /** For tests: a starter that returns a stop function instead of running preview.command. */
  start?: (preview: Preview, cwd: string) => Promise<() => void>;
  now?: () => Date;
}

const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function commitOf(cwd: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

function ping(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(url, res => { res.resume(); resolve((res.statusCode ?? 500) < 500); });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/** Starts the app and waits until it answers. Returns a function that stops it and everything it started. */
export async function startPreview(preview: Preview, cwd: string): Promise<() => void> {
  const child: ChildProcess = spawn(preview.command, { cwd, shell: true, detached: true, stdio: 'ignore', env: { ...process.env, BROWSER: 'none', CI: '1' } });
  const stop = (): void => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
  let exited: number | null | undefined;
  child.on('exit', code => { exited = code; });
  const deadline = Date.now() + preview.timeout_s * 1000;
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`preview.command exited with ${exited} before the app answered at ${preview.url}${preview.ready_path}`);
    if (await ping(preview.url + preview.ready_path)) return stop;
    await new Promise(r => setTimeout(r, 500));
  }
  stop();
  throw new Error(`the app did not answer at ${preview.url}${preview.ready_path} within ${preview.timeout_s} s (preview.command: ${preview.command})`);
}

/** Playwright from the project, or from FACTORY_PLAYWRIGHT_PATH, or from the factory; a clear message when there is none. */
export function playwrightShooter(cwd: string): Shooter {
  const paths = [cwd, process.env.FACTORY_PLAYWRIGHT_PATH, path.resolve(__dirname, '..', '..')].filter((p): p is string => !!p);
  let pw: any;
  for (const p of paths) {
    try { pw = require(require.resolve('playwright', { paths: [p] })); break; } catch { /* try the next place */ }
  }
  if (!pw) throw new Error('Playwright is not installed. Run `npm install -D playwright` in the project and `npx playwright install chromium` (or set FACTORY_PLAYWRIGHT_PATH to a directory that contains it)');
  let browser: any;
  return {
    async shoot(url, check, width, file) {
      browser = browser ?? await pw.chromium.launch();
      // Fixed everything that varies between runs, so a difference between two pictures is a difference in the app
      const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC' });
      try {
        const page = await context.newPage();
        await page.goto(url + check.path, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
        if (check.wait_for) await page.waitForSelector(check.wait_for, { timeout: 15_000 });
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
      } finally {
        await context.close();
      }
    },
    async close() { if (browser) await browser.close(); browser = undefined; }
  };
}

/** Photographs every screen at every width for one label and writes a manifest next to the pictures. */
export async function captureEvidence(opts: CaptureOptions): Promise<Manifest> {
  if (opts.checks.length === 0) throw new Error('there are no screens to capture: the plan has no visual_checks');
  const dir = path.join(opts.outDir, opts.label);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const shooter = opts.shooter ?? playwrightShooter(opts.cwd);
  const stop = await (opts.start ?? startPreview)(opts.preview, opts.cwd);
  const shots: Shot[] = [];
  try {
    for (const check of opts.checks) {
      for (const width of check.widths) {
        const file = shotFile(check.name, width);
        const abs = path.join(dir, file);
        await shooter.shoot(opts.preview.url, check, width, abs);
        if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) throw new Error(`no picture was written for ${check.name} at ${width}`);
        shots.push({ check: check.name, width, file, sha256: sha256(abs) });
      }
    }
  } finally {
    await shooter.close();
    stop();
  }
  const manifest: Manifest = { version: 1, label: opts.label, commit: commitOf(opts.cwd), createdAt: (opts.now ?? (() => new Date()))().toISOString(), shots };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

export function readManifest(dir: string): Manifest {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as Manifest;
  if (m.version !== 1 || !Array.isArray(m.shots)) throw new Error(`${dir}/manifest.json is not an evidence manifest`);
  return m;
}
