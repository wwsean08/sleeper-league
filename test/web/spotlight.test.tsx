import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Spotlight } from '../../src/web/pages/Spotlight';
import { liveMatchupIds, type StoreState } from '../../src/web/store';

const NOW = 10_000_000;
const st = (id: string, name: string, points: number) => ({ playerId: id, name, position: 'RB', points });
const side = (rosterId: number, teamName: string, score: number, starters: ReturnType<typeof st>[] = []) => ({ rosterId, teamName, score, starters });
const play = (id: string, pid: string, over: Record<string, unknown> = {}) => ({
  playId: id, gameId: 'g', description: `desc-${id}`, quarter: '2', clock: '5:00', yards: 5,
  involved: [{ playerId: pid, name: 'x', rosterId: 1, points: 1.5 }], at: NOW - 1000, ...over,
});
const m1 = { matchupId: 1, sides: [side(1, 'Alpha', 100.25, [st('a1', 'Ann Ace', 12.3)]), side(2, 'Beta', 90, [st('b1', 'Bob Back', 4)])] };
const m2 = { matchupId: 2, sides: [side(3, 'Gamma', 50, [st('c1', 'Cy Core', 1)]), side(4, 'Delta', 50, [st('d1', 'Di Dash', 2)])] };
function mk(matchups: unknown[], feed: unknown[] = [], rotationSeconds?: number): StoreState {
  return {
    league: { week: 7, standings: [], matchups, estimating: false },
    feed,
    takeover: null,
    status: 'live',
    ...(rotationSeconds ? { snapshot: { ui: { rotationSeconds } } } : {}),
  } as unknown as StoreState;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Spotlight', () => {
  it('shows both teams, scores, starters and last 5 involved plays', () => {
    const feed = [1, 2, 3, 4, 5, 6, 7].map((i) => play(`p${i}`, 'a1', { at: NOW - i }));
    render(<Spotlight store={mk([m1], feed)} now={NOW} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('100.3').className).toContain('text-good');
    expect(screen.getByText('90.0').className).not.toContain('text-good');
    expect(screen.getByText('Ann Ace')).toBeInTheDocument();
    expect(screen.getByText('Bob Back')).toBeInTheDocument();
    expect(screen.getByText('12.3')).toBeInTheDocument();
    for (const i of [1, 2, 3, 4, 5]) expect(screen.getByText(`desc-p${i}`)).toBeInTheDocument();
    expect(screen.queryByText('desc-p6')).toBeNull();
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });
  it('ties are neutral', () => {
    render(<Spotlight store={mk([m2])} now={NOW} />);
    for (const s of screen.getAllByText('50.0')) expect(s.className).not.toContain('text-good');
  });
  it('rotates after rotationSeconds', () => {
    render(<Spotlight store={mk([m1, m2], [], 10)} now={NOW} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(9999));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
  it('defaults to 15s and changed rotationSeconds changes the interval', () => {
    const { rerender } = render(<Spotlight store={mk([m1, m2])} now={NOW} />);
    act(() => void vi.advanceTimersByTime(14_999));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    rerender(<Spotlight store={mk([m1, m2], [], 5)} now={NOW} />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
  it('skips non-live matchups when some are live', () => {
    const feed = [play('l', 'c1')];
    render(<Spotlight store={mk([m1, m2], feed, 10)} now={NOW} />);
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(screen.queryByText('Alpha')).toBeNull();
  });
  it('keeps index valid when list shrinks', () => {
    const { rerender } = render(<Spotlight store={mk([m1, m2], [], 10)} now={NOW} />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    rerender(<Spotlight store={mk([m1], [], 10)} now={NOW} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
  it('shows empty message with zero matchups', () => {
    render(<Spotlight store={mk([])} now={NOW} />);
    expect(screen.getByText('No matchups right now')).toBeInTheDocument();
  });
  it('waits without league data', () => {
    render(<Spotlight store={{ feed: [], takeover: null, status: 'live', everLive: true } as unknown as StoreState} now={NOW} />);
    expect(screen.getByText('Waiting for league data…')).toBeInTheDocument();
  });
  it('shows the estimating badge only when the league is estimating', () => {
    render(<Spotlight store={mk([m1])} now={NOW} />);
    expect(screen.queryByText('estimating')).toBeNull();
    cleanup();
    const store = mk([m1]);
    render(<Spotlight store={{ ...store, league: { ...store.league!, estimating: true } }} now={NOW} />);
    expect(screen.getByText('estimating')).toBeInTheDocument();
  });
  it('shows BYE for a one-sided matchup', () => {
    render(<Spotlight store={mk([{ matchupId: 9, sides: [side(1, 'Solo', 0)] }])} now={NOW} />);
    expect(screen.getByText('Solo')).toBeInTheDocument();
    expect(screen.getByText('BYE')).toBeInTheDocument();
  });
});

describe('liveMatchupIds', () => {
  it('returns matchups with a recent play by a starter', () => {
    const league = { week: 1, standings: [], matchups: [m1, m2], estimating: false } as never;
    expect([...liveMatchupIds(league, [play('x', 'd1')] as never, NOW)]).toEqual([2]);
    expect(liveMatchupIds(league, [play('x', 'd1', { at: NOW - 16 * 60_000 })] as never, NOW).size).toBe(0);
    expect(liveMatchupIds(undefined, [], NOW).size).toBe(0);
  });
});
