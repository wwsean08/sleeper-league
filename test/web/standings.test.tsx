import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Standings } from '../../src/web/pages/Standings';
import type { StoreState } from '../../src/web/store';

function mk(n: number, over: Record<number, object> = {}): StoreState {
  const standings = Array.from({ length: n }, (_, i) => ({
    rosterId: i + 1, teamName: `Team ${i + 1}`, wins: 10 - (i % 10), losses: i % 10, ties: 0, fpts: 1000.456 - i, ...(over[i] ?? {}),
  }));
  return { league: { week: 3, standings, matchups: [], estimating: false }, feed: [], takeover: undefined, status: 'live', connected: true } as unknown as StoreState;
}

afterEach(cleanup);

describe('Standings', () => {
  it('shows a waiting message without league data', () => {
    render(<Standings store={{ feed: [], status: 'live', connected: true } as unknown as StoreState} />);
    expect(screen.getByText('Waiting for league data…')).toBeInTheDocument();
  });
  it('renders rank, name, record, points in order', () => {
    render(<Standings store={mk(3, { 1: { ties: 2 } })} />);
    expect(screen.getByText('Standings')).toBeInTheDocument();
    const rows = screen.getAllByTestId('standing-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('Team 1');
    expect(rows[0]).toHaveTextContent('10-0');
    expect(rows[0]).toHaveTextContent('1000.5');
    expect(rows[1]).toHaveTextContent('9-1-2');
    expect(rows[2]).toHaveTextContent('Team 3');
  });
  it('fits 18 teams without scrolling and truncates names', () => {
    const { container } = render(<Standings store={mk(18)} />);
    expect(screen.getAllByTestId('standing-row')).toHaveLength(18);
    expect(container.innerHTML).not.toMatch(/overflow-y-(auto|scroll)|overflow-(auto|scroll)/);
    expect(screen.getByText('Team 1').className).toContain('truncate');
  });
  it.each([[6, 1, 6, 'text-4xl'], [10, 2, 5, 'text-4xl'], [12, 2, 6, 'text-4xl'], [18, 2, 9, 'text-3xl'], [20, 2, 10, 'text-2xl']])(
    'derives layout for %i teams',
    (n, cols, rows, text) => {
      render(<Standings store={mk(n)} />);
      const grid = screen.getByTestId('standings-grid');
      expect(grid.getAttribute('style')).toContain(`repeat(${cols}, minmax(0, 1fr))`);
      expect(grid.getAttribute('style')).toContain(`repeat(${rows}, minmax(0, 1fr))`);
      expect(screen.getAllByTestId('standing-row')).toHaveLength(n);
      expect(screen.getAllByTestId('standing-row')[0]!.className).toContain(text);
    },
  );
});
