import fs from 'node:fs';
import nodePath from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Config {
  leagueId: string;
  token?: string;
  theme: {
    logo?: string;
    colors: Record<'bg' | 'surface' | 'text' | 'accent' | 'good' | 'alert', string>;
    fontFamily: string;
  };
  showLeagueName: boolean;
  rotationSeconds: number;
  takeoverSeconds: number;
  takeoverQueueLimit: number;
  longGainYards: number;
  pollSeconds: number;
  spotlightMinPlayPoints: number;
  port: number;
  playlist: Array<'standings' | 'schedule' | 'spotlight' | 'feed'>;
  playlistSeconds: number;
}

const colorsSchema = z
  .object({
    bg: z.string().default('#0e1a2b'),
    surface: z.string().default('#16263d'),
    text: z.string().default('#ffffff'),
    accent: z.string().default('#ffb300'),
    good: z.string().default('#7cfc9a'),
    alert: z.string().default('#ff5722'),
  })
  .prefault({});

const schema = z.object({
  leagueId: z.union([z.string().min(1), z.number().int().transform(String)], {
    error: 'leagueId is required (non-empty string or integer)',
  }),
  token: z.string().optional(),
  tokenFile: z.string().optional(),
  theme: z
    .object({
      logo: z.string().optional(),
      colors: colorsSchema,
      fontFamily: z.string().default('system-ui, sans-serif'),
    })
    .prefault({}),
  showLeagueName: z.boolean().default(true),
  rotationSeconds: z.number().positive().default(15),
  takeoverSeconds: z.number().positive().default(8),
  takeoverQueueLimit: z.number().int().positive().default(3),
  longGainYards: z.number().positive().default(40),
  pollSeconds: z.number().positive().default(60),
  spotlightMinPlayPoints: z.number().min(0).default(0.1),
  port: z.number().int().positive().default(3000),
  playlist: z
    .array(z.enum(['standings', 'schedule', 'spotlight', 'feed']))
    .default(['standings', 'schedule']),
  playlistSeconds: z.number().positive().default(20),
});

export function loadConfig(path: string, environment: NodeJS.ProcessEnv = process.env): Config {
  let text: string;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`Cannot read config ${path}: ${((e as Error).message ?? '').split('\n')[0]}`);
  }
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    // YAML errors embed a source snippet that may contain secrets; keep only the first line and position.
    const err = e as Error & { linePos?: Array<{ line: number; col: number }> };
    const pos = err.linePos?.[0];
    const where = pos ? ` (line ${pos.line}, column ${pos.col})` : '';
    throw new ConfigError(`Invalid YAML in ${path}: ${(err.message ?? '').split('\n')[0]}${where}`);
  }
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid config: ${msg}`);
  }
  const { tokenFile, token: fileToken, ...rest } = result.data;
  let token = fileToken;
  if (tokenFile) {
    try {
      token = fs.readFileSync(nodePath.resolve(nodePath.dirname(path), tokenFile), 'utf8').trim();
    } catch {
      throw new ConfigError(`Cannot read tokenFile ${tokenFile}`);
    }
  }
  if (environment.SLEEPER_TOKEN) token = environment.SLEEPER_TOKEN;
  const config: Config = { ...rest };
  if (token) config.token = token;
  return config;
}

export function watchConfig(
  path: string,
  onChange: (c: Config) => void,
  onError: (e: Error) => void,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  const reload = () => {
    try {
      onChange(loadConfig(path));
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  };
  // Watch the parent directory so atomic saves (temp file + rename) are still seen.
  const dir = nodePath.dirname(path);
  const base = nodePath.basename(path);
  const watcher = fs.watch(dir, (_event, filename) => {
    if (filename && filename.toString() !== base) return;
    clearTimeout(timer);
    timer = setTimeout(reload, 200);
  });
  watcher.on('error', (e) => onError(e instanceof Error ? e : new Error(String(e))));
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
