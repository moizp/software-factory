#!/usr/bin/env node
/**
 * Layout guard: loads the real page and reads the real element boxes, so crowding and overlap are found by a check
 * instead of by eye. Rules R1 to R8 of UI-RULES.md.
 *
 *   node scripts/layout-guard.cjs [--url <base> | --file <page.html>] [--json <out>]   run the guard
 *   node scripts/layout-guard.cjs prove --base <ref> [--file <page.html>] [--out <f>]  must FAIL on <ref>, PASS on the working tree
 *
 * Mark each row of controls `data-layout-row="name"`. Mark content whose length varies `data-guard-worst="999 / 999|9999 / 9999"`
 * (the guard swaps each variant in). Limits can only be tightened: `layout-guard.config.json` may raise a limit or add a
 * width, theme or text size; it can never lower or remove one.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

// What the owner stated (UI-RULES.md). Raising these is allowed through the config; lowering is ignored.
const LIMITS = Object.freeze({ controlGap: 6, labelGap: 8, labelPadding: 4, touch: 44 });
const MATRIX = Object.freeze({ widths: [320, 375, 390, 768, 1280], themes: ['light', 'dark'], textSizes: [100, 150, 200] });
const DEFAULTS = Object.freeze({ pages: ['/'], themeAttribute: 'data-theme', readySelector: 'body[data-hydrated]', timeoutMs: 15000 });

const union = (base, extra) => [...new Set([...base, ...(Array.isArray(extra) ? extra : [])])];

/** The effective settings: the stated minimums, tightened (never loosened) by the project's config. Returns the notes for anything ignored. */
function resolveConfig(raw = {}) {
  const ignored = [];
  const limits = { ...LIMITS };
  for (const [k, v] of Object.entries(raw.limits || {})) {
    if (!(k in LIMITS)) ignored.push(`limit "${k}" is not one of ${Object.keys(LIMITS).join(', ')}`);
    else if (typeof v !== 'number') ignored.push(`limit "${k}" must be a number`);
    else if (v < LIMITS[k]) ignored.push(`limit "${k}" = ${v} is below the stated ${LIMITS[k]} and is ignored: limits can only be tightened`);
    else limits[k] = v;
  }
  for (const k of ['widths', 'themes', 'textSizes']) {
    const dropped = MATRIX[k].filter(x => Array.isArray(raw[k]) && !raw[k].includes(x));
    if (dropped.length) ignored.push(`${k} cannot drop ${dropped.join(', ')}; they stay in the matrix`);
  }
  return {
    limits,
    widths: union(MATRIX.widths, raw.widths),
    themes: union(MATRIX.themes, raw.themes),
    textSizes: union(MATRIX.textSizes, raw.textSizes),
    pages: raw.pages && raw.pages.length ? raw.pages : DEFAULTS.pages,
    themeAttribute: raw.themeAttribute || DEFAULTS.themeAttribute,
    readySelector: raw.readySelector === false ? false : raw.readySelector || DEFAULTS.readySelector,
    timeoutMs: raw.timeoutMs || DEFAULTS.timeoutMs,
    ignored
  };
}

// ---------- pure checks over measured boxes (tested without a browser) ----------

const px = n => `${Math.round(n * 10) / 10} px`;
const label = it => `"${it.name}" (${it.kind})`;

/** Space between two boxes: negative when they overlap, the nearest-edge distance otherwise. */
function gapBetween(a, b) {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
  if (dx < 0 && dy < 0) return Math.max(dx, dy);
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

const isControl = it => it.kind !== 'counter' && it.kind !== 'label';

/**
 * One row of measured items in a window. Item: { name, kind, bordered, box:{x,y,w,h}, padL, padR, ring, defaultWidth }.
 * Returns violations { rule, message, hint } that name both elements and the gap in px.
 */
function evaluateRow(row, limits = LIMITS) {
  const out = [];
  const add = (rule, message, hint) => out.push({ rule, message: `row "${row.name}": ${message}`, hint });
  const items = row.items;

  for (const it of items) {
    const right = it.box.x + it.box.w;
    if (it.box.x < -0.5 || right > row.viewport.w + 0.5) {
      add('R7', `${label(it)} is outside the window (left ${px(it.box.x)}, right ${px(right)} of ${row.viewport.w} px)`, 'flex-wrap on the row, min-w-0 on the flexible item, shrink-0 on a control');
    }
    if (isControl(it) && (it.box.w < limits.touch - 0.5 || it.box.h < limits.touch - 0.5)) {
      add('R6', `${label(it)} is ${Math.round(it.box.w * 10) / 10} x ${Math.round(it.box.h * 10) / 10} px; touch targets need at least ${limits.touch} px`, 'size-11 (44 px), or min-h-11 min-w-11');
    }
    if (isControl(it) && it.ring === 0) {
      add('R5', `${label(it)} has no visible focus ring when focused with the keyboard`, 'focus-visible:ring-4 (keep the ring, make room instead)');
    }
    if (it.defaultWidth !== undefined && Math.abs(it.box.w - it.defaultWidth) > 0.5) {
      const ch = it.worstLen ? it.worstLen + 1 : 12;
      add('R4', `${label(it)} grows from ${px(it.defaultWidth)} to ${px(it.box.w)} when its content is longest; reserve a minimum width`, `min-w-[${ch}ch] tabular-nums text-center (the longest content is ${it.worstLen || 'N'} characters; reserve one more)`);
    }
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const gap = gapBetween(a.box, b.box);
      if (gap < 0) {
        add('R1', `${label(a)} and ${label(b)} overlap by ${px(-gap)}`, 'gap-2 on the row');
        continue;
      }
      const both = isControl(a) && isControl(b);
      const labelNextToBorder = (x, y) => !isControl(x) && isControl(y) && y.bordered;
      const need = both ? limits.controlGap : labelNextToBorder(a, b) || labelNextToBorder(b, a) ? limits.labelGap : 0;
      if (need > 0 && gap < need - 0.01) {
        add(both ? 'R1' : 'R2', `${label(a)} and ${label(b)} are ${px(gap)} apart, need at least ${need} px`, 'gap-2 (8 px) on the row');
      }
      for (const [x, y] of [[a, b], [b, a]]) {
        if (isControl(x) && x.ring > 0 && gap < x.ring - 0.01) {
          add('R5', `the focus ring (${px(x.ring)}) of ${label(x)} covers ${label(y)}, ${px(gap)} away`, 'gap-2 (8 px) on the row; keep the ring');
        }
      }
    }
  }

  // a counter or label with a bordered control on each side needs padding of its own
  const line = [...items].sort((a, b) => a.box.x - b.box.x);
  for (let i = 1; i < line.length - 1; i++) {
    const m = line[i], l = line[i - 1], r = line[i + 1];
    if (isControl(m) || !(l.bordered && isControl(l) && r.bordered && isControl(r))) continue;
    if (Math.abs(l.box.y - r.box.y) > Math.max(l.box.h, r.box.h)) continue; // not on one line
    if (m.padL < limits.labelPadding - 0.01 || m.padR < limits.labelPadding - 0.01) {
      add('R3', `${label(m)} sits between ${label(l)} and ${label(r)} without its own horizontal padding (left ${px(m.padL)}, right ${px(m.padR)}, need at least ${limits.labelPadding} px each)`, 'px-2');
    }
  }
  return out;
}

/** The page as a whole: no sideways scroll. */
function evaluateFit(page) {
  return page.scrollWidth > page.viewport.w + 1
    ? [{ rule: 'R7', message: `the page scrolls sideways: content is ${page.scrollWidth} px wide in a ${page.viewport.w} px window`, hint: 'flex-wrap, min-w-0, shrink-0, max-w-full' }]
    : [];
}

// ---------- the browser side ----------
// These functions run inside the page (they are sent as source), so they use nothing from this file.

/** How far the focus ring reaches beyond the element: an outline, or a box-shadow ring (what Tailwind's ring-* draws). */
function ringOf(el) {
  const cs = getComputedStyle(el);
  let ext = 0;
  if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ext = Math.max(0, parseFloat(cs.outlineWidth) + (parseFloat(cs.outlineOffset) || 0));
  for (const s of cs.boxShadow.split(/,(?![^(]*\))/)) {
    if (!s.trim() || s.trim() === 'none' || /\binset\b/.test(s)) continue;
    const n = (s.match(/-?\d*\.?\d+px/g) || []).map(parseFloat);
    if (n.length >= 3) ext = Math.max(ext, (n[3] || 0) + Math.max(Math.abs(n[0]), Math.abs(n[1])));
  }
  return ext;
}

/** Every row, as plain data: items with box, padding, kind, and (focused with the keyboard) the ring each control shows. */
function readRows(ringOf) {
  const CONTROL = 'button, a[href], input, select, textarea, summary, [role=button], [role=link], [tabindex]:not([tabindex="-1"])';
  return [...document.querySelectorAll('[data-layout-row]')].map(row => ({
    name: row.getAttribute('data-layout-row'),
    items: [...row.children].filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).map(el => {
      const control = el.matches(CONTROL);
      let ring;
      if (control) { el.focus({ preventScroll: true }); ring = ringOf(el); el.blur(); }
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const border = ['Top', 'Right', 'Bottom', 'Left'].reduce((t, d) => t + (parseFloat(cs['border' + d + 'Width']) || 0), 0);
      return {
        name: el.getAttribute('data-guard-name') || el.getAttribute('aria-label') || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.tagName.toLowerCase(),
        kind: el.getAttribute('data-guard-kind') || (control ? (el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? 'input' : 'button') : 'label'),
        bordered: control && (border > 0 || (ring || 0) > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)),
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
        padL: parseFloat(cs.paddingLeft) || 0,
        padR: parseFloat(cs.paddingRight) || 0,
        ring,
        worst: el.hasAttribute('data-guard-worst')
      };
    })
  }));
}

const settle = page => page.evaluate(() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));

function loadPlaywright() {
  for (const from of [process.cwd(), process.env.FACTORY_PLAYWRIGHT_PATH].filter(Boolean)) {
    try { return require(require.resolve('playwright', { paths: [from, path.join(from, 'node_modules')] })); } catch { /* next */ }
  }
  try { return require('playwright'); } catch { /* fall through */ }
  throw new Error('playwright is not installed. Run `npm i -D playwright` (a dev dependency the owner approves) or set FACTORY_PLAYWRIGHT_PATH to a folder that has it');
}

function record(map, v, where) {
  const e = map.get(v.message) || { ...v, count: 0, first: where };
  e.count++;
  map.set(v.message, e);
}

/** Runs the whole matrix. Returns { combos, rows, violations } with one entry per distinct violation. */
async function runGuard({ baseUrl, config: cfg }) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const found = new Map();
  let combos = 0, rowsSeen = 0;
  try {
    for (const pagePath of cfg.pages) {
      const ctx = await browser.newContext({ viewport: { width: cfg.widths[0], height: 800 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(new URL(pagePath, baseUrl).href, { waitUntil: 'load', timeout: cfg.timeoutMs });
      if (cfg.readySelector) {
        await page.waitForSelector(cfg.readySelector, { state: 'attached', timeout: cfg.timeoutMs }).catch(() => {
          throw new Error(`the page never became ready: no element matches "${cfg.readySelector}" on ${pagePath || '/'}. Hydrate first, then set it (SvelteKit: onMount(() => { document.body.dataset.hydrated = "true"; }))`);
        });
      }
      await page.keyboard.press('Tab'); // one real key press, so the focus() calls that follow show :focus-visible
      const worst = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[data-guard-worst]')];
        els.forEach(e => e.setAttribute('data-guard-orig', e.textContent));
        return els.map(e => e.getAttribute('data-guard-worst').split('|'));
      });
      const variants = Math.max(0, ...worst.map(w => w.length));
      for (const theme of cfg.themes) {
        await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
        await page.evaluate(([a, t]) => document.documentElement.setAttribute(a, t), [cfg.themeAttribute, theme]);
        for (const text of cfg.textSizes) {
          await page.evaluate(s => { document.documentElement.style.fontSize = `${s}%`; }, text);
          for (const w of cfg.widths) {
            await page.setViewportSize({ width: w, height: 800 });
            let defaults = null;
            for (let v = -1; v < variants; v++) { // -1 is the page as shipped; then each worst-case variant
              await page.evaluate(i => document.querySelectorAll('[data-guard-worst]').forEach(e => {
                const all = e.getAttribute('data-guard-worst').split('|');
                e.textContent = i < 0 ? e.getAttribute('data-guard-orig') : all[Math.min(i, all.length - 1)];
              }), v);
              await settle(page);
              const content = v < 0 ? 'default content' : `worst "${worst[0] ? worst[0][Math.min(v, worst[0].length - 1)] : ''}"`;
              const where = `${pagePath || '/'} · ${w} px · ${theme} · ${text}% text · ${content}`;
              const rows = await page.evaluate(`(${readRows})(${ringOf})`);
              if (v < 0) defaults = rows.map(r => r.items.map(i => i.box.w));
              combos++;
              rowsSeen += rows.length;
              rows.forEach((row, ri) => {
                row.items.forEach((it, ci) => { if (v >= 0 && it.worst && defaults && defaults[ri]) { it.defaultWidth = defaults[ri][ci]; it.worstLen = Math.max(...worst.flat().map(x => x.length)); } });
                evaluateRow({ name: row.name, items: row.items, viewport: { w } }, cfg.limits).forEach(x => record(found, x, where));
              });
              const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
              evaluateFit({ scrollWidth, viewport: { w } }).forEach(x => record(found, x, where));
            }
          }
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  if (rowsSeen === 0) record(found, { rule: 'R8', message: 'no [data-layout-row] found on any page: mark each row of controls with data-layout-row="name"', hint: '' }, 'setup');
  return { combos, rows: rowsSeen, violations: [...found.values()] };
}

// ---------- serving, proof and CLI ----------

/** Resolves when the preview server says it is listening (its own output is the state), rejects if it exits or takes too long. */
function waitForServer(child, ms) {
  return new Promise((resolve, reject) => {
    const limit = AbortSignal.timeout(ms);
    limit.addEventListener('abort', () => reject(new Error(`the preview server did not start within ${ms} ms`)));
    child.stdout.on('data', d => { if (/localhost:\d+|Local:/.test(String(d))) resolve(); });
    child.on('exit', code => reject(new Error(`the preview server exited with code ${code} before it was ready. Run \`npm run build\` first`)));
  });
}

async function withServer(cwd, port, fn) {
  const child = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  try {
    await waitForServer(child, 60000);
    return await fn(`http://localhost:${port}/`);
  } finally {
    try { process.kill(-child.pid); } catch { /* already gone */ }
  }
}

function readConfig(cwd) {
  const f = path.join(cwd, 'layout-guard.config.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : {};
}

function render(result, cfg) {
  const lines = [];
  for (const v of result.violations) lines.push(`  ${v.rule}  ${v.message}\n        first at ${v.first} (${v.count} of ${result.combos} combinations)${v.hint ? `\n        fix with Tailwind: ${v.hint}` : ''}`);
  for (const n of cfg.ignored) lines.push(`  note  ${n}`);
  return lines.join('\n');
}

const arg = (name, argv = process.argv) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

async function guardTarget({ cwd, file, url, cfg }) {
  if (file) return runGuard({ baseUrl: 'file://' + path.resolve(file), config: { ...cfg, pages: [''] } });
  if (url) return runGuard({ baseUrl: url, config: cfg });
  return withServer(cwd, 4173, u => runGuard({ baseUrl: u, config: cfg }));
}

async function main(argv) {
  const cwd = process.cwd();
  const cfg = resolveConfig(readConfig(cwd));
  const prove = argv[2] === 'prove';
  if (!prove) {
    const result = await guardTarget({ cwd, file: arg('file', argv), url: arg('url', argv), cfg });
    if (arg('json', argv)) fs.writeFileSync(arg('json', argv), JSON.stringify(result, null, 2));
    if (result.violations.length) { console.error(`layout guard: ${result.violations.length} violation(s) in ${result.combos} combinations\n${render(result, cfg)}`); return 1; }
    console.log(`layout guard: pass (${result.rows} rows read in ${result.combos} combinations: widths ${cfg.widths.join('/')}, ${cfg.themes.length} themes, text ${cfg.textSizes.join('/')}%)`);
    cfg.ignored.forEach(n => console.log(`  note  ${n}`));
    return 0;
  }
  // prove: the guard must FAIL on the base and PASS on the fix
  const base = arg('base', argv);
  if (!base) { console.error('Usage: layout-guard prove --base <ref> [--file <page.html>] [--out <file>]'); return 2; }
  const file = arg('file', argv);
  let before;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-prove-'));
  try {
    if (file) {
      const old = path.join(scratch, 'base.html');
      fs.writeFileSync(old, execFileSync('git', ['show', `${base}:${file.replace(/^\.\//, '')}`], { encoding: 'utf-8', cwd }));
      before = await guardTarget({ cwd, file: old, cfg });
    } else {
      const tree = path.join(scratch, 'base');
      execFileSync('git', ['worktree', 'add', '--detach', tree, base], { cwd, stdio: 'ignore' });
      try {
        fs.symlinkSync(path.join(cwd, 'node_modules'), path.join(tree, 'node_modules'), 'dir');
        execFileSync('npm', ['run', 'build'], { cwd: tree, stdio: 'ignore' });
        before = await withServer(tree, 4174, u => runGuard({ baseUrl: u, config: cfg }));
      } finally {
        execFileSync('git', ['worktree', 'remove', '--force', tree], { cwd, stdio: 'ignore' });
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const after = await guardTarget({ cwd, file, url: arg('url', argv), cfg });
  const ok = before.violations.length > 0 && after.violations.length === 0;
  const text = [
    '## Layout proof',
    `Base (${base}): ${before.violations.length ? 'FAIL' : 'PASS'} (${before.violations.length} violations in ${before.combos} combinations)`,
    `Head: ${after.violations.length ? 'FAIL' : 'PASS'} (${after.violations.length} violations in ${after.combos} combinations)`,
    ...before.violations.slice(0, 3).map(v => `- base: ${v.message}`),
    ...after.violations.slice(0, 3).map(v => `- head: ${v.message}`),
    ok ? 'Result: proven (the guard fails on the old code and passes on the fix).' : 'Result: NOT proven. ' + (before.violations.length === 0 ? 'The guard passes on the old code, so it does not show the defect: add the row, the worst-case content or a rule it lacks, then prove again.' : 'The guard still fails on the fix.')
  ].join('\n');
  if (arg('out', argv)) fs.writeFileSync(arg('out', argv), text + '\n');
  console.log(text);
  return ok ? 0 : 1;
}

module.exports = { LIMITS, MATRIX, resolveConfig, evaluateRow, evaluateFit, gapBetween, runGuard, main };

if (require.main === module) {
  main(process.argv).then(code => process.exit(code), err => { console.error(`layout guard: ${err.message}`); process.exit(2); });
}
