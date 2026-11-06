import { describe, expect, it } from 'vitest';
import { hasLiveStarters, initialState, reduce } from '../../src/web/store';
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
  matchups: [{ matchupId: 1, sides: [{ rosterId: 1, teamName: 'A', score: 0, starters: [{ playerId: 'p1', name: 'P', position: 'QB', points: 0 }] }] }],
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
  ui: { rotationSeconds: 15, takeoverSeconds: 8, playlist: ['standings'], playlistSeconds: 20 },
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

describe('hasLiveStarters', () => {
  const now = 10_000_000;
  const inv = [{ playerId: 'p1', name: 'P', rosterId: 1, points: 1 }];
  it('true for a recent play by a starter', () => {
    expect(hasLiveStarters(league(), [play('a', { at: now - 60_000, involved: inv })], now)).toBe(true);
  });
  it('false when stale, non-starter, or no league', () => {
    expect(hasLiveStarters(league(), [play('a', { at: now - 16 * 60_000, involved: inv })], now)).toBe(false);
    expect(hasLiveStarters(league(), [play('a', { at: now, involved: [{ ...inv[0]!, playerId: 'zz' }] })], now)).toBe(false);
    expect(hasLiveStarters(undefined, [play('a', { at: now, involved: inv })], now)).toBe(false);
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
