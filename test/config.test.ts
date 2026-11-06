import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, watchConfig, ConfigError } from '../src/server/config.js';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  dirs.push(d);
  return d;
}
function write(content: string, name = 'config.yaml'): string {
  const p = path.join(tmp(), name);
  fs.writeFileSync(p, content);
  return p;
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('applies defaults for a minimal file', () => {
    const c = loadConfig(write('leagueId: "123"\n'), {});
    expect(c.leagueId).toBe('123');
    expect(c.rotationSeconds).toBe(15);
    expect(c.takeoverSeconds).toBe(8);
    expect(c.takeoverQueueLimit).toBe(3);
    expect(c.longGainYards).toBe(40);
    expect(c.pollSeconds).toBe(60);
    expect(c.port).toBe(3000);
    expect(c.playlist).toEqual(['standings', 'schedule']);
    expect(c.playlistSeconds).toBe(20);
    expect(c.theme.colors.bg).toBe('#0e1a2b');
    expect(c.theme.colors.alert).toBe('#ff5722');
    expect(c.theme.fontFamily).toBe('system-ui, sans-serif');
  });

  it('throws ConfigError when leagueId is missing', () => {
    expect(() => loadConfig(write('port: 1\n'), {})).toThrow(ConfigError);
  });

  it('SLEEPER_TOKEN env overrides file token', () => {
    const p = write('leagueId: "1"\ntoken: filetok\n');
    expect(loadConfig(p, {}).token).toBe('filetok');
    expect(loadConfig(p, { SLEEPER_TOKEN: 'envtok' }).token).toBe('envtok');
  });

  it('reads and trims tokenFile', () => {
    const secret = write('  secret-abc \n', 'secrets.txt');
    const p = write(`leagueId: "1"\ntokenFile: ${secret}\n`);
    expect(loadConfig(p, {}).token).toBe('secret-abc');
  });

  it('throws ConfigError for unreadable tokenFile', () => {
    const p = write('leagueId: "1"\ntokenFile: /nonexistent/nope\n');
    expect(() => loadConfig(p, {})).toThrow(ConfigError);
  });
});

describe('watchConfig', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('calls onChange on valid rewrite and onError (not onChange) on invalid', async () => {
    const p = write('leagueId: "1"\n');
    const changes: number[] = [];
    const errors: Error[] = [];
    const stop = watchConfig(p, (c) => changes.push(c.rotationSeconds), (e) => errors.push(e));
    try {
      await wait(100); // let the watcher attach before the first write
      fs.writeFileSync(p, 'leagueId: "1"\nrotationSeconds: 30\n');
      await wait(700);
      expect(changes).toEqual([30]);
      expect(errors).toHaveLength(0);

      fs.writeFileSync(p, 'leagueId: [unclosed\n  : : bad');
      await wait(700);
      expect(changes).toEqual([30]);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });
});
