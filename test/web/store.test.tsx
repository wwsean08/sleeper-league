import { describe, expect, it } from 'vitest';
import { feedPaused, hasLiveStarters, initialState, isStale, reduce } from '../../src/web/store';
import { choosePage } from '../../src/web/App';
import type { PlayEntry } from '../../src/server/plays';
import type { LeagueView } from '../../src/server/league';
import type { ServerMessage } from '../../src/server/hub';

const play = (id: string, over: Partial<PlayEntry> = {}): PlayEntry => ({
  playId: id, gameId: 'g', description: id, quarter: '1', clock: '10:00', yards: 5, involved: [], at: 0, ...over,
});
const league = (over: Partial<LeagueView> = {}): LeagueView => ({
  week: 1,
  standings: [],
  matchups: [{ matchupId: 1, sides: [{ rosterId: 1, teamName: 'A', score: 0, starters: [{ playerId: 'p1', name: 'P', position: 'QB', points: 0, live: false }] }] }],
  estimating: false,
  ...over,
});
const snapshot = (over: Record<string, unknown> = {}): Extract<ServerMessage, { type: 'snapshot' }> => ({
  type: 'snapshot',
  league: league(),
  feed: [play('a')],
  takeover: null,
  status: 'live',
  theme: { colors: { bg: '', surface: '', text: '', accent: '', good: '', alert: '' }, fontFamily: 'x' },
  ui: { rotationSeconds: 15, takeoverSeconds: 8, playlist: ['standings'], playlistSeconds: 20, pollSeconds: 60, spotlightMinPlayPoints: 0.1 },
  leagueName: 'L',
  ...over,
});

describe('reduce', () => {
  it('applies a takeover message', () => {
    const s = reduce(initialState, { type: 'takeover', play: play('t') });
    expect(s.takeover?.playId).toBe('t');
  });
  it('a new snapshot replaces everything', () => {
    let s = reduce(initialState, snapshot());
    s = reduce(s, { type: 'feed', play: play('b') });
    s = reduce(s, { type: 'takeover', play: play('t') });
    s = reduce(s, { type: 'status', status: 'paused' });
    expect(s.feed.map((p) => p.playId)).toEqual(['b', 'a']);
    s = reduce(s, snapshot({ feed: [play('z')], leagueName: 'L2' }));
    expect(s.feed.map((p) => p.playId)).toEqual(['z']);
    expect(s.takeover).toBeNull();
    expect(s.status).toBe('live');
    expect(s.snapshot?.leagueName).toBe('L2');
  });
  it('replaces league and caps the feed at 200', () => {
    let s = reduce(initialState, snapshot());
    s = reduce(s, { type: 'league', league: league({ week: 9 }) });
    expect(s.league?.week).toBe(9);
    for (let i = 0; i < 250; i++) s = reduce(s, { type: 'feed', play: play(`f${i}`) });
    expect(s.feed).toHaveLength(200);
    expect(s.feed[0]!.playId).toBe('f249');
  });
});

describe('snapshot ordering', () => {
  it('normalizes the oldest-first server feed to newest-first', () => {
    let s = reduce(initialState, snapshot({ feed: [play('oldest'), play('middle'), play('newest')] }));
    s = reduce(s, { type: 'feed', play: play('live') });
    expect(s.feed.map((p) => p.playId)).toEqual(['live', 'newest', 'middle', 'oldest']);
  });
});

describe('hasLiveStarters', () => {
  const withStarter = (live: boolean) =>
    league({
      matchups: [{ matchupId: 1, sides: [{ rosterId: 1, teamName: 'A', score: 0, starters: [{ playerId: 'p1', name: 'P', position: 'K', points: 0, live }] }] }],
    });
  it('true while a starter\'s game is in progress, even with no plays at all', () => {
    expect(hasLiveStarters(withStarter(true))).toBe(true);
  });
  it('false when no starter is live', () => {
    expect(hasLiveStarters(withStarter(false))).toBe(false);
    expect(hasLiveStarters(league())).toBe(false);
  });
  it('false when there is no league yet, or no matchups', () => {
    expect(hasLiveStarters(undefined)).toBe(false);
    expect(hasLiveStarters(league({ matchups: [] }))).toBe(false);
  });
});

describe('choosePage', () => {
  const base = { hash: '', playlist: ['standings', 'schedule'] as string[], playlistSeconds: 10, live: false, now: 0 };
  it('hash forces a page', () => {
    expect(choosePage({ ...base, hash: '#/feed', live: true })).toBe('feed');
  });
  it('live forces spotlight', () => {
    expect(choosePage({ ...base, live: true })).toBe('spotlight');
  });
  it('cycles the playlist otherwise', () => {
    expect(choosePage({ ...base, now: 0 })).toBe('standings');
    expect(choosePage({ ...base, now: 10_000 })).toBe('schedule');
    expect(choosePage({ ...base, now: 20_000 })).toBe('standings');
  });
  it('falls back to standings with an empty playlist', () => {
    expect(choosePage({ ...base, playlist: [] })).toBe('standings');
  });
});

describe('isStale', () => {
  const t0 = 1_000_000;
  it('undefined lastPollOkAt (before the first poll) is never stale', () => {
    expect(isStale(undefined, 60, t0 + 10 * 60_000)).toBe(false);
  });
  it('exactly 2x pollSeconds is not stale; 2x + 1ms is', () => {
    expect(isStale(t0, 60, t0 + 120_000)).toBe(false);
    expect(isStale(t0, 60, t0 + 120_001)).toBe(true);
    expect(isStale(t0, 10, t0 + 20_001)).toBe(true);
  });
});

describe('lastPollOkAt and league in the store', () => {
  it('a snapshot without league keeps league undefined', () => {
    const s = reduce(initialState, snapshot({ league: undefined }));
    expect(s.league).toBeUndefined();
    expect(s.lastPollOkAt).toBeUndefined();
  });
  it('snapshot and league messages carry lastPollOkAt', () => {
    let s = reduce(initialState, snapshot({ lastPollOkAt: 5 }));
    expect(s.lastPollOkAt).toBe(5);
    s = reduce(s, { type: 'league', league: league(), lastPollOkAt: 9 });
    expect(s.lastPollOkAt).toBe(9);
    s = reduce(s, { type: 'league', league: league() });
    expect(s.lastPollOkAt).toBe(9);
  });
});

describe('feed paused / everLive', () => {
  it('connecting is paused only after having been live', () => {
    expect(feedPaused('connecting', false)).toBe(false);
    expect(feedPaused('connecting', true)).toBe(true);
    expect(feedPaused('paused', false)).toBe(true);
    expect(feedPaused('live', true)).toBe(false);
  });
  it('everLive latches on the first live status and survives a new snapshot', () => {
    let s = reduce(initialState, snapshot({ status: 'connecting' }));
    expect(s.everLive).toBe(false);
    s = reduce(s, { type: 'status', status: 'live' });
    expect(s.everLive).toBe(true);
    s = reduce(s, { type: 'status', status: 'connecting' });
    s = reduce(s, snapshot({ status: 'connecting' }));
    expect(s.everLive).toBe(true);
  });
});
