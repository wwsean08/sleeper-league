import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LiveGames, PLAY_TTL_MS, STATUS_TTL_MS, isGameFinished, isGameLive } from '../src/server/liveGames.js';

const T0 = 1_000_000_000;
const MIN = 60_000;

const frame = (gameId: string, home: string, away: string, md: Record<string, unknown>) => ({
  game_id: gameId,
  metadata: { home_team: home, away_team: away, ...md },
});
const LIVE = { status: 'inprogress', has_started: true, closed: false };
const PRE = { status: 'scheduled', has_started: false, closed: false };
const DONE = { status: 'closed', has_started: true, closed: true };
const teams = (g: LiveGames, now: number) => [...g.teams(now)].sort();

describe('isGameLive / isGameFinished', () => {
  it('live: started, not closed, not a finished status', () => {
    expect(isGameLive(LIVE)).toBe(true);
    expect(isGameLive(PRE)).toBe(false);
    expect(isGameLive(DONE)).toBe(false);
    expect(isGameLive({ status: 'inprogress', has_started: true, closed: true })).toBe(false);
    expect(isGameLive(undefined)).toBe(false);
    expect(isGameLive({})).toBe(false);
  });
  it.each(['complete', 'closed', 'final'])('status %s is finished', (status) => {
    expect(isGameLive({ status, has_started: true, closed: false })).toBe(false);
    expect(isGameFinished({ status })).toBe(true);
  });
  it('closed:true is finished whatever the status string says', () => {
    expect(isGameFinished({ status: 'inprogress', closed: true })).toBe(true);
  });
  it('pre-game and in-progress are not finished', () => {
    expect(isGameFinished(PRE)).toBe(false);
    expect(isGameFinished(LIVE)).toBe(false);
    expect(isGameFinished(undefined)).toBe(false);
  });
});

describe('LiveGames from game status (score_updated frames or the scores poll)', () => {
  it('a started game makes both teams active and reports the change', () => {
    const g = new LiveGames();
    expect(g.update(frame('1', 'BAL', 'JAX', LIVE), T0)).toBe(true);
    expect(teams(g, T0)).toEqual(['BAL', 'JAX']);
  });
  it('repeating the same state is not a change', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0);
    expect(g.update(frame('1', 'BAL', 'JAX', LIVE), T0 + 5_000)).toBe(false);
  });
  it('a game that has not started is not active', () => {
    const g = new LiveGames();
    expect(g.update(frame('1', 'BAL', 'JAX', PRE), T0)).toBe(false);
    expect(g.teams(T0).size).toBe(0);
  });
  it('the game ending removes both teams immediately', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0);
    expect(g.update(frame('1', 'BAL', 'JAX', DONE), T0 + 3 * MIN)).toBe(true);
    expect(g.teams(T0 + 3 * MIN).size).toBe(0);
  });
  it('a finished game stays finished even if a stale live status arrives afterwards', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', DONE), T0);
    expect(g.update(frame('1', 'BAL', 'JAX', LIVE), T0 + 1_000)).toBe(false);
    expect(g.teams(T0 + 1_000).size).toBe(0);
  });
  it('tracks several games independently', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0);
    g.update(frame('2', 'KC', 'DEN', LIVE), T0);
    g.update(frame('3', 'NYG', 'DAL', PRE), T0);
    g.update(frame('4', 'SF', 'LAR', DONE), T0);
    expect(teams(g, T0)).toEqual(['BAL', 'DEN', 'JAX', 'KC']);
  });
  it('status goes stale after 5 minutes without a refresh, so a lost source cannot leave teams active forever', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0);
    expect(g.teams(T0 + STATUS_TTL_MS).size).toBe(2);
    expect(g.teams(T0 + STATUS_TTL_MS + 1).size).toBe(0);
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0 + STATUS_TTL_MS); // a refresh extends it
    expect(g.teams(T0 + 2 * STATUS_TTL_MS).size).toBe(2);
  });
  it('ignores frames without a game id, a metadata object or team names', () => {
    const g = new LiveGames();
    expect(g.update({ metadata: LIVE }, T0)).toBe(false);
    expect(g.update(frame('9', '', '', LIVE), T0)).toBe(false);
    expect(g.update({ game_id: '9' }, T0)).toBe(false);
    expect(g.update(null, T0)).toBe(false);
    expect(g.teams(T0).size).toBe(0);
  });
});

describe('LiveGames from plays: any play for a team means that team is active', () => {
  it('a single play activates both teams with no status information at all', () => {
    const g = new LiveGames();
    expect(g.markPlay('1', ['BAL', 'JAX'], T0)).toBe(true);
    expect(teams(g, T0)).toEqual(['BAL', 'JAX']);
  });
  it('with no status at all, activity lasts until 30 minutes of silence', () => {
    const g = new LiveGames();
    g.markPlay('1', ['BAL', 'JAX'], T0);
    expect(g.teams(T0 + PLAY_TTL_MS).size).toBe(2);
    expect(g.teams(T0 + PLAY_TTL_MS + 1).size).toBe(0);
  });
  it('each new play extends the activity (halftime or a delay under 30 minutes keeps the team active)', () => {
    const g = new LiveGames();
    g.markPlay('1', ['BAL', 'JAX'], T0);
    g.markPlay('1', ['BAL', 'JAX'], T0 + 25 * MIN);
    expect(g.teams(T0 + 50 * MIN).size).toBe(2);
  });
  it('a finished status ends a game that plays had activated', () => {
    const g = new LiveGames();
    g.markPlay('1', ['BAL', 'JAX'], T0);
    expect(g.update(frame('1', 'BAL', 'JAX', DONE), T0 + 1_000)).toBe(true);
    expect(g.teams(T0 + 1_000).size).toBe(0);
  });
  it('a late play for a finished game does not bring it back', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', DONE), T0);
    expect(g.markPlay('1', ['BAL', 'JAX'], T0 + 1_000)).toBe(false);
    expect(g.teams(T0 + 1_000).size).toBe(0);
  });
  it('a stale "not started" status does not cancel a game that plays say is underway', () => {
    const g = new LiveGames();
    g.markPlay('1', ['BAL', 'JAX'], T0);
    g.update(frame('1', 'BAL', 'JAX', PRE), T0 + 1_000);
    expect(teams(g, T0 + 1_000)).toEqual(['BAL', 'JAX']);
  });
  it('uses the known teams for a game when the play does not name them', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', PRE), T0);
    g.markPlay('1', [], T0 + 1_000);
    expect(teams(g, T0 + 1_000)).toEqual(['BAL', 'JAX']);
  });
  it('ignores plays with no game id or no usable team names and nothing known', () => {
    const g = new LiveGames();
    expect(g.markPlay(undefined, ['BAL'], T0)).toBe(false);
    expect(g.markPlay('1', [], T0)).toBe(false);
    expect(g.markPlay('1', ['', undefined as never], T0)).toBe(false);
    expect(g.teams(T0).size).toBe(0);
  });
  it('different games activate different teams', () => {
    const g = new LiveGames();
    g.markPlay('1', ['BAL', 'JAX'], T0);
    g.markPlay('2', ['KC', 'DEN'], T0);
    expect(teams(g, T0)).toEqual(['BAL', 'DEN', 'JAX', 'KC']);
  });
});

describe('LiveGames when the feed is lost', () => {
  it('dropPlayActivity removes play-derived activity but keeps status-derived activity', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0);
    g.markPlay('2', ['KC', 'DEN'], T0);
    expect(g.dropPlayActivity(T0 + 1_000)).toBe(true);
    expect(teams(g, T0 + 1_000)).toEqual(['BAL', 'JAX']);
  });
  it('reports no change when nothing was play-derived', () => {
    const g = new LiveGames();
    g.update(frame('1', 'BAL', 'JAX', LIVE), T0);
    expect(g.dropPlayActivity(T0 + 1_000)).toBe(false);
  });
});

describe('LiveGames on the real sample capture', () => {
  const lines = readFileSync('docs/samples/score-nfl-frames-2026-11-05.log', 'utf8').split('\n').filter((l) => l.trim());
  const frames = lines.map((l) => JSON.parse(l.slice(l.indexOf(' ') + 1)) as [unknown, unknown, string, string, any]);

  it('score_updated frames: BAL vs JAX is active', () => {
    const g = new LiveGames();
    for (const m of frames) if (m[3] === 'score_updated') g.update(m[4], T0);
    expect(teams(g, T0)).toEqual(['BAL', 'JAX']);
  });
  it('play frames alone also activate BAL and JAX (no score_updated needed)', () => {
    const g = new LiveGames();
    for (const m of frames) {
      if (m[3] === 'new_play' || m[3] === 'updated_play') {
        g.markPlay(m[4].game_id, [m[4].metadata?.team, m[4].metadata?.opponent], T0);
      }
    }
    expect(teams(g, T0)).toEqual(['BAL', 'JAX']);
  });
});
