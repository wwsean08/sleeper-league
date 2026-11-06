import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Spotlight } from '../../src/web/pages/Spotlight';
import { liveMatchupIds, type StoreState } from '../../src/web/store';

const NOW = 10_000_000;
const st = (id: string, name: string, points: number, live = false) => ({ playerId: id, name, position: 'RB', points, live });
const side = (rosterId: number, teamName: string, score: number, starters: ReturnType<typeof st>[] = []) => ({ rosterId, teamName, score, starters });
const play = (id: string, pid: string, over: Record<string, unknown> = {}) => ({
  playId: id, gameId: 'g', description: `desc-${id}`, quarter: '2', clock: '5:00', yards: 5,
  involved: [{ playerId: pid, name: 'x', rosterId: 1, points: 1.5 }], at: NOW - 1000, ...over,
});
const m1 = { matchupId: 1, sides: [side(1, 'Alpha', 100.25, [st('a1', 'Ann Ace', 12.3)]), side(2, 'Beta', 90, [st('b1', 'Bob Back', 4)])] };
const m2 = { matchupId: 2, sides: [side(3, 'Gamma', 50, [st('c1', 'Cy Core', 1)]), side(4, 'Delta', 50, [st('d1', 'Di Dash', 2)])] };
function mk(matchups: unknown[], feed: unknown[] = [], rotationSeconds?: number, spotlightMinPlayPoints?: number): StoreState {
  const ui = { ...(rotationSeconds ? { rotationSeconds } : {}), ...(spotlightMinPlayPoints !== undefined ? { spotlightMinPlayPoints } : {}) };
  return {
    league: { week: 7, standings: [], matchups, estimating: false },
    feed,
    takeover: null,
    status: 'live',
    ...(Object.keys(ui).length ? { snapshot: { ui } } : {}),
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
  it('subtly highlights starters whose game is live and leaves the rest plain', () => {
    const liveSide = side(1, 'Alpha', 10, [st('a1', 'Ann Ace', 5, true), st('a2', 'Al Idle', 5, false)]);
    render(<Spotlight store={mk([{ matchupId: 1, sides: [liveSide, side(2, 'Beta', 9)] }])} now={NOW} />);
    const live = screen.getByText('Ann Ace').closest('li')!;
    const idle = screen.getByText('Al Idle').closest('li')!;
    expect(live.getAttribute('data-live')).toBe('true');
    expect(live.className).toContain('bg-accent/10');
    expect(live.querySelector('[aria-label="game in progress"]')).not.toBeNull();
    expect(idle.getAttribute('data-live')).toBe('false');
    expect(idle.className).not.toContain('bg-accent/10');
    expect(idle.querySelector('[aria-label="game in progress"]')).toBeNull();
  });
  describe('recent plays threshold', () => {
    const withPts = (id: string, pts: number, pid = 'a1', over: Record<string, unknown> = {}) =>
      play(id, pid, { involved: [{ playerId: pid, name: 'x', rosterId: 1, points: pts }], ...over });

    it('hides plays whose points for this matchup are under 0.1', () => {
      const feed = [withPts('zero', 0), withPts('tiny', 0.05), withPts('edge', 0.1), withPts('big', 4.2)];
      render(<Spotlight store={mk([m1], feed)} now={NOW} />);
      expect(screen.queryByText('desc-zero')).toBeNull();
      expect(screen.queryByText('desc-tiny')).toBeNull();
      expect(screen.getByText('desc-edge')).toBeInTheDocument();
      expect(screen.getByText('desc-big')).toBeInTheDocument();
    });
    it('keeps negative plays, since a turnover still moves the score', () => {
      render(<Spotlight store={mk([m1], [withPts('int', -2), withPts('lost', -0.05)])} now={NOW} />);
      expect(screen.getByText('desc-int')).toBeInTheDocument();
      expect(screen.queryByText('desc-lost')).toBeNull();
    });
    it('sums every starter of this matchup who was involved before comparing', () => {
      const two = play('two', 'a1', {
        involved: [
          { playerId: 'a1', name: 'x', rosterId: 1, points: 0.06 },
          { playerId: 'b1', name: 'y', rosterId: 2, points: 0.06 },
        ],
      });
      render(<Spotlight store={mk([m1], [two])} now={NOW} />);
      expect(screen.getByText('desc-two')).toBeInTheDocument();
    });
    it('ignores points earned by players who are not in this matchup', () => {
      const other = play('other', 'a1', {
        involved: [
          { playerId: 'a1', name: 'x', rosterId: 1, points: 0 },
          { playerId: 'zz', name: 'z', rosterId: 9, points: 8 },
        ],
      });
      render(<Spotlight store={mk([m1], [other])} now={NOW} />);
      expect(screen.queryByText('desc-other')).toBeNull();
    });
    it('shows the latest five that qualify, skipping non-scoring plays in between', () => {
      const feed = [
        withPts('n1', 0), withPts('q1', 1), withPts('n2', 0), withPts('q2', 1), withPts('q3', 1),
        withPts('n3', 0), withPts('q4', 1), withPts('q5', 1), withPts('q6', 1),
      ];
      render(<Spotlight store={mk([m1], feed)} now={NOW} />);
      for (const id of ['q1', 'q2', 'q3', 'q4', 'q5']) expect(screen.getByText(`desc-${id}`)).toBeInTheDocument();
      expect(screen.queryByText('desc-q6')).toBeNull();
    });
    it('uses the configured threshold from the snapshot', () => {
      const feed = [withPts('p03', 0.3), withPts('p15', 1.5), withPts('p5', 5)];
      render(<Spotlight store={mk([m1], feed, undefined, 1)} now={NOW} />);
      expect(screen.queryByText('desc-p03')).toBeNull();
      expect(screen.getByText('desc-p15')).toBeInTheDocument();
      expect(screen.getByText('desc-p5')).toBeInTheDocument();
    });
    it('a threshold of 0 shows every play, including zero-point ones', () => {
      render(<Spotlight store={mk([m1], [withPts('z', 0), withPts('t', 0.02)], undefined, 0)} now={NOW} />);
      expect(screen.getByText('desc-z')).toBeInTheDocument();
      expect(screen.getByText('desc-t')).toBeInTheDocument();
    });
    it('changing the threshold in a new snapshot applies to the rows immediately', () => {
      const feed = [withPts('p03', 0.3)];
      const { rerender } = render(<Spotlight store={mk([m1], feed, undefined, 1)} now={NOW} />);
      expect(screen.queryByText('desc-p03')).toBeNull();
      rerender(<Spotlight store={mk([m1], feed, undefined, 0.1)} now={NOW} />);
      expect(screen.getByText('desc-p03')).toBeInTheDocument();
    });
    it('shows "No plays yet" when every recent play is under the threshold', () => {
      render(<Spotlight store={mk([m1], [withPts('z1', 0), withPts('z2', 0.02)])} now={NOW} />);
      expect(screen.getByText('No plays yet')).toBeInTheDocument();
    });
    it('still treats a matchup as live from a zero-point play, so rotation is unaffected', () => {
      render(<Spotlight store={mk([m1, m2], [withPts('z', 0, 'c1', { involved: [{ playerId: 'c1', name: 'x', rosterId: 3, points: 0 }] })])} now={NOW} />);
      expect(screen.getByText('Gamma')).toBeInTheDocument(); // only m2 is live, so it is the one shown
    });
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
