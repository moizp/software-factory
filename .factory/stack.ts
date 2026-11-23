import * as fs from 'fs';
import * as path from 'path';

/**
 * The stack a project declares in project.config.json, and the default when it declares none. Agents run without tools
 * and never see the config file, so the orchestrator reads it once and hands them this small object.
 */

export interface Stack {
  /** The stack id, such as "ts-sveltekit-node". */
  id?: string;
  frontend: Record<string, string>;
  backend: Record<string, string>;
  database?: string;
  /** True when the project declared no frontend, and the default below was used. */
  frontendIsDefault: boolean;
}

/** Svelte and SvelteKit with TypeScript, scoped CSS from the design tokens, and Svelte's own state: the fewest imports. */
export const DEFAULT_FRONTEND: Record<string, string> = {
  framework: 'sveltekit',
  language: 'typescript',
  styling: 'scoped-css',
  state_management: 'svelte-runes'
};

const MAX_VALUE = 60;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Only short string values are kept: a config value is data, never an instruction. */
function strings(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && /^[a-z_]{1,30}$/.test(k) && v.trim()) out[k] = v.trim().slice(0, MAX_VALUE);
  }
  return out;
}

export function parseStack(config: unknown): Stack {
  const c = isRecord(config) ? config : {};
  const frontend = strings(c.frontend);
  const database = isRecord(c.backend) && typeof c.backend.database === 'string' ? c.backend.database.trim().slice(0, MAX_VALUE) : undefined;
  return {
    ...(typeof c.stack === 'string' && c.stack.trim() ? { id: c.stack.trim().slice(0, MAX_VALUE) } : {}),
    frontend: Object.keys(frontend).length ? frontend : { ...DEFAULT_FRONTEND },
    backend: strings(c.backend),
    ...(database ? { database } : {}),
    frontendIsDefault: Object.keys(frontend).length === 0
  };
}

/** The stack of the project in `cwd`; the default when there is no readable project.config.json. */
export function loadStack(cwd: string = process.cwd()): Stack {
  try {
    return parseStack(JSON.parse(fs.readFileSync(path.join(cwd, 'project.config.json'), 'utf-8')));
  } catch {
    return parseStack(undefined);
  }
}

export function stackForAgents(s: Stack): Record<string, unknown> {
  return { ...(s.id ? { id: s.id } : {}), frontend: s.frontend, backend: s.backend, ...(s.database ? { database: s.database } : {}) };
}

export function renderStackLine(s: Stack): string {
  const f = s.frontend;
  return `frontend ${f.framework ?? 'unspecified'} (${f.language ?? 'typescript'})${s.frontendIsDefault ? ', the default' : ''}${s.id ? `, stack ${s.id}` : ''}`;
}
