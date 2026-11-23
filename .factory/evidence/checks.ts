/**
 * What a person approves before the build (the screens to photograph) and what the project says about starting its
 * app. Pure parsing: problems are described precisely so the agent that wrote them can fix them when asked again.
 */

export const WIDTHS = [375, 768, 1280] as const;
export const MAX_CHECKS = 8;

export interface VisualCheck {
  /** Short and unique within the list; it becomes part of the file name. */
  name: string;
  /** The page to open, starting with "/". */
  path: string;
  /** Viewport widths in pixels, from WIDTHS. */
  widths: number[];
  /** A selector that must be on the page before the picture is taken. */
  wait_for?: string;
  /** What state of the screen this shows, in words, for the person approving the plan. */
  state?: string;
}

export interface Preview {
  /** Starts the app, such as "npm run dev". Runs in the project directory. */
  command: string;
  /** Where the app listens once it is up. */
  url: string;
  /** A path on that url which answers when the app is ready. */
  ready_path: string;
  timeout_s: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function parseVisualChecks(raw: unknown, where = 'visual_checks'): Parsed<VisualCheck[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${where} must be a list` };
  if (raw.length > MAX_CHECKS) return { ok: false, error: `${where} has more than ${MAX_CHECKS} screens; pick the ones the change can affect` };
  const seen = new Set<string>();
  const out: VisualCheck[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const at = `${where}[${i}]`;
    if (!isRecord(c)) return { ok: false, error: `${at} must be an object` };
    if (!isString(c.name) || !NAME.test(c.name)) return { ok: false, error: `${at}.name must be lower case letters, digits and dashes (for example "signup-error")` };
    if (seen.has(c.name)) return { ok: false, error: `${at}.name "${c.name}" is used twice` };
    seen.add(c.name);
    if (!isString(c.path) || !c.path.startsWith('/') || c.path.includes('..') || /\s/.test(c.path)) return { ok: false, error: `${at}.path must start with "/" and name a page of the app (for example "/signup")` };
    let widths: number[] = [375, 1280];
    if (c.widths !== undefined) {
      if (!Array.isArray(c.widths) || c.widths.length === 0 || !c.widths.every(w => (WIDTHS as readonly number[]).includes(w as number))) {
        return { ok: false, error: `${at}.widths must be a non-empty list from ${WIDTHS.join(', ')}` };
      }
      widths = [...new Set(c.widths as number[])].sort((a, b) => a - b);
    }
    if (c.wait_for !== undefined && (!isString(c.wait_for) || !c.wait_for.trim() || c.wait_for.length > 200)) return { ok: false, error: `${at}.wait_for must be a selector` };
    if (c.state !== undefined && (!isString(c.state) || c.state.length > 200)) return { ok: false, error: `${at}.state must be a short description` };
    out.push({
      name: c.name,
      path: c.path,
      widths,
      ...(isString(c.wait_for) ? { wait_for: c.wait_for.trim() } : {}),
      ...(isString(c.state) && c.state.trim() ? { state: c.state.trim() } : {})
    });
  }
  return { ok: true, value: out };
}

/** The `preview` object of project.config.json. */
export function parsePreview(raw: unknown): Parsed<Preview> {
  if (!isRecord(raw)) return { ok: false, error: 'project.config.json needs a "preview" object: { "command": "npm run dev", "url": "http://localhost:3000" }' };
  if (!isString(raw.command) || !raw.command.trim()) return { ok: false, error: 'preview.command must say how to start the app' };
  if (!isString(raw.url) || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(raw.url)) return { ok: false, error: 'preview.url must be a local address such as http://localhost:3000' };
  const ready = raw.ready_path === undefined ? '/' : raw.ready_path;
  if (!isString(ready) || !ready.startsWith('/')) return { ok: false, error: 'preview.ready_path must start with "/"' };
  const timeout = raw.timeout_s === undefined ? 60 : raw.timeout_s;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 600) return { ok: false, error: 'preview.timeout_s must be a whole number of seconds from 1 to 600' };
  return { ok: true, value: { command: raw.command.trim(), url: raw.url.replace(/\/$/, ''), ready_path: ready, timeout_s: timeout } };
}

/** Plain file name for one picture. */
export const shotFile = (check: string, width: number): string => `${check}-${width}.png`;
