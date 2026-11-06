import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LiveGames, isGameLive } from '../src/server/liveGames.js';

const frame = (gameId: string, home: string, away: string, md: Record<string, unknown>) => ({
  game_id: gameId,
  metadata: { home_team: home, away_team: away, ...md },
});

describe('isGameLive', () => {
  it('is live when started, not closed, and status is in progress', () => {
    expect(isGameLive({ status: 'inprogress', has_started: true, closed: false })).toBe(true);
  });
  it('is not live before kickoff', () => {
    expect(isGameLive({ status: 'pre_game', has_started: false, closed: false })).toBe(false);
  });
  it.each(['complete', 'closed', 'final'])('is not live when status is %s', (status) => {
    expect(isGameLive({ status, has_started: true, closed: false })).toBe(false);
  });
  it('is not live when closed is true, whatever the status says', () => {
    expect(isGameLive({ status: 'inprogress', has_started: true, closed: true })).toBe(false);
  });
  it('treats a missing or odd metadata object as not live', () => {
    expect(isGameLive(undefined)).toBe(false);
    expect(isGameLive({})).toBe(false);
  });
});

describe('LiveGames', () => {
  it('tracks both teams of a live game and reports the change', () => {
    const g = new LiveGames();
    expect(g.update(frame('1', 'BAL', 'JAX', { status: 'inprogress', has_started: true, closed: false }))).toBe(true);
    expect([...g.teams()].sort()).toEqual(['BAL', 'JAX']);
  });
  it('reports no change when the same state repeats', () => {
    const g = new LiveGames();
    const f = frame('1', 'BAL', 'JAX', { status: 'inprogress', has_started: true, closed: false });
    g.update(f);
    expect(g.update(f)).toBe(false);
  });
  it('drops a game when it finishes', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', { status: 'inprogress', has_started: true, closed: false }));
    expect(g.update(frame('1', 'BAL', 'JAX', { status: 'complete', has_started: true, closed: false }))).toBe(true);
    expect(g.teams().size).toBe(0);
  });
  it('tracks several games at once', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', { status: 'inprogress', has_started: true, closed: false }));
    g.update(frame('2', 'KC', 'DEN', { status: 'inprogress', has_started: true, closed: false }));
    g.update(frame('3', 'NYG', 'DAL', { status: 'pre_game', has_started: false, closed: false }));
    expect([...g.teams()].sort()).toEqual(['BAL', 'DEN', 'JAX', 'KC']);
  });
  it('ignores frames without a game id or team names', () => {
    const g = new LiveGames();
    expect(g.update({ metadata: { status: 'inprogress', has_started: true } })).toBe(false);
    expect(g.update(frame('9', '', '', { status: 'inprogress', has_started: true }))).toBe(false);
    expect(g.update(null)).toBe(false);
    expect(g.teams().size).toBe(0);
  });
  it('clear() empties the set and reports whether anything changed', () => {
    const g = new LiveGames();
    expect(g.clear()).toBe(false);
    g.update(frame('1', 'BAL', 'JAX', { status: 'inprogress', has_started: true, closed: false }));
    expect(g.clear()).toBe(true);
    expect(g.teams().size).toBe(0);
  });
  it('reads the real sample capture: BAL vs JAX is live', () => {
    const g = new LiveGames();
    for (const line of readFileSync('docs/samples/score-nfl-frames-2026-11-05.log', 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const m = JSON.parse(line.slice(line.indexOf(' ') + 1));
      if (m[3] === 'score_updated') g.update(m[4]);
    }
    expect([...g.teams()].sort()).toEqual(['BAL', 'JAX']);
  });
});
