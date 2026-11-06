import fs from 'node:fs';
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
  rotationSeconds: number;
  takeoverSeconds: number;
  takeoverQueueLimit: number;
  longGainYards: number;
  pollSeconds: number;
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
  leagueId: z.coerce.string().min(1, 'leagueId is required'),
  token: z.string().optional(),
  tokenFile: z.string().optional(),
  theme: z
    .object({
      logo: z.string().optional(),
      colors: colorsSchema,
      fontFamily: z.string().default('system-ui, sans-serif'),
    })
    .prefault({}),
  rotationSeconds: z.number().positive().default(15),
  takeoverSeconds: z.number().positive().default(8),
  takeoverQueueLimit: z.number().int().positive().default(3),
  longGainYards: z.number().positive().default(40),
  pollSeconds: z.number().positive().default(60),
  port: z.number().int().positive().default(3000),
  playlist: z
    .array(z.enum(['standings', 'schedule', 'spotlight', 'feed']))
    .default(['standings', 'schedule']),
  playlistSeconds: z.number().positive().default(20),
});

export function loadConfig(path: string, environment: NodeJS.ProcessEnv = process.env): Config {
  let raw: unknown;
  try {
    raw = parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Cannot read config ${path}: ${(e as Error).message}`);
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
      token = fs.readFileSync(tokenFile, 'utf8').trim();
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
  const watcher = fs.watch(path, () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 200);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
