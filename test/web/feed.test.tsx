import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Feed } from '../../src/web/pages/Feed';
import type { StoreState } from '../../src/web/store';

const play = (i: number, over: Record<string, unknown> = {}) => ({
  playId: `p${i}`, gameId: 'g', description: `desc-${i}`, quarter: '2', clock: `${i}:00`, yards: 5,
  involved: [{ playerId: 'a', name: 'Ann', rosterId: 1, points: 2.5 }], at: i, ...over,
});
const mk = (feed: unknown[]): StoreState => ({
  league: { week: 1, standings: [], estimating: false, matchups: [{ matchupId: 1, sides: [{ rosterId: 1, teamName: 'Alpha', score: 0, starters: [] }] }] },
  feed, takeover: null, status: 'live',
}) as unknown as StoreState;

afterEach(cleanup);

describe('Feed', () => {
  it('shows empty message', () => {
    render(<Feed store={mk([])} />);
    expect(screen.getByText('Waiting for plays…')).toBeInTheDocument();
  });
  it('renders newest first with team, points, clock and badge', () => {
    render(<Feed store={mk([play(3, { kind: 'touchdown' }), play(2), play(1)])} />);
    const rows = screen.getAllByTestId('feed-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('desc-3'), expect.stringContaining('desc-2'), expect.stringContaining('desc-1'),
    ]);
    expect(rows[0]!.textContent).toContain('Alpha');
    expect(rows[0]!.textContent).toContain('+2.5');
    expect(rows[0]!.textContent).toContain('3:00');
    expect(rows[0]!.textContent).toContain('TOUCHDOWN');
    expect(rows[1]!.textContent).not.toContain('TOUCHDOWN');
  });
  it('caps at 50 rows', () => {
    render(<Feed store={mk(Array.from({ length: 80 }, (_, i) => play(80 - i)))} />);
    expect(screen.getAllByTestId('feed-row')).toHaveLength(50);
    expect(screen.getByText('desc-80')).toBeInTheDocument();
    expect(screen.queryByText('desc-30')).toBeNull();
  });
});
