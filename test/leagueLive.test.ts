import { describe, expect, it } from 'vitest';
import { LeagueState } from '../src/server/league.js';
import type { Matchup, PlayerInfo, Roster } from '../src/shared/types.js';

const players = new Map<string, PlayerInfo>([
  ['p1', { id: 'p1', name: 'Alpha', position: 'WR', team: 'BAL' }],
  ['p2', { id: 'p2', name: 'Beta', position: 'RB', team: 'KC' }],
  ['p3', { id: 'p3', name: 'Gamma', position: 'WR' }], // no team known
  ['BAL', { id: 'BAL', name: 'Baltimore Ravens', position: 'DEF', team: 'BAL' }],
  ['DEN', { id: 'DEN', name: 'Denver Broncos', position: 'DEF' }], // DEF entry without a team field
]);
const roster = (rosterId: number, starters: string[]): Roster => ({
  rosterId, ownerId: `o${rosterId}`, teamName: `Team${rosterId}`, wins: 0, losses: 0, ties: 0, fpts: 0,
  players: starters, starters,
});
const matchups: Matchup[] = [
  {
    matchupId: 1,
    sides: [
      { rosterId: 1, points: 0, starters: ['p1', 'p2', 'BAL'] },
      { rosterId: 2, points: 0, starters: ['p3', 'DEN', '0'] },
    ],
  },
];
const make = () => {
  const l = new LeagueState({}, players);
  l.loadWeek(9, [roster(1, ['p1', 'p2', 'BAL']), roster(2, ['p3', 'DEN'])], matchups);
  return l;
};
const live = (l: LeagueState) =>
  Object.fromEntries(l.view().matchups[0]!.sides.flatMap((s) => s.starters.map((st) => [st.playerId, st.live])));

describe('LeagueState live teams', () => {
  it('marks nobody live by default', () => {
    expect(Object.values(live(make())).every((v) => v === false)).toBe(true);
  });

  it('marks starters whose NFL team is in a live game', () => {
    const l = make();
    expect(l.setLiveTeams(new Set(['BAL']))).toBe(true);
    expect(live(l)).toEqual({ p1: true, p2: false, BAL: true, p3: false, DEN: false });
  });

  it('treats a DEF starter as live when its own id is a live team, even without a team field', () => {
    const l = make();
    l.setLiveTeams(new Set(['DEN']));
    expect(live(l).DEN).toBe(true);
  });

  it('never marks a player with an unknown team live by accident', () => {
    const l = make();
    l.setLiveTeams(new Set(['BAL', 'KC', 'DEN']));
    expect(live(l).p3).toBe(false);
  });

  it('reports whether the live set changed', () => {
    const l = make();
    expect(l.setLiveTeams(new Set(['BAL']))).toBe(true);
    expect(l.setLiveTeams(new Set(['BAL']))).toBe(false);
    expect(l.setLiveTeams(new Set())).toBe(true);
    expect(live(l).p1).toBe(false);
  });

  it('keeps the live set across loadWeek and across a players refresh', () => {
    const l = make();
    l.setLiveTeams(new Set(['BAL']));
    l.loadWeek(9, [roster(1, ['p1', 'p2', 'BAL']), roster(2, ['p3', 'DEN'])], matchups);
    expect(live(l).p1).toBe(true);
    l.setPlayers(new Map(players));
    expect(live(l).p1).toBe(true);
  });

  it('does not mark an empty slot id live', () => {
    const l = make();
    l.setLiveTeams(new Set(['0']));
    expect(Object.keys(live(l))).not.toContain('0');
  });
});
