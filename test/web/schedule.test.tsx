import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Schedule } from '../../src/web/pages/Schedule';
import type { StoreState } from '../../src/web/store';

const side = (rosterId: number, teamName: string, score: number) => ({ rosterId, teamName, score, starters: [] });
function mk(matchups: unknown[], estimating = false): StoreState {
  return { league: { week: 7, standings: [], matchups, estimating }, feed: [], status: 'live', connected: true } as unknown as StoreState;
}

afterEach(cleanup);

describe('Schedule', () => {
  it('waits without league data', () => {
    render(<Schedule store={{ feed: [], status: 'live', connected: true } as unknown as StoreState} />);
    expect(screen.getByText('Waiting for league data…')).toBeInTheDocument();
  });
  it('renders week title, teams, scores, leader highlight, ties neutral', () => {
    render(<Schedule store={mk([
      { matchupId: 1, sides: [side(1, 'Alpha', 100.25), side(2, 'Beta', 90)] },
      { matchupId: 2, sides: [side(3, 'Gamma', 50), side(4, 'Delta', 50)] },
    ])} />);
    expect(screen.getByText('Week 7 Schedule')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('100.3').className).toContain('text-good');
    expect(screen.getByText('90.0').className).not.toContain('text-good');
    for (const s of screen.getAllByText('50.0')) expect(s.className).not.toContain('text-good');
  });
  it('shows the estimating badge only when the league is estimating', () => {
    const ms = [{ matchupId: 1, sides: [side(1, 'Alpha', 1), side(2, 'Beta', 2)] }];
    render(<Schedule store={mk(ms)} />);
    expect(screen.queryByText('estimating')).toBeNull();
    cleanup();
    render(<Schedule store={mk(ms, true)} />);
    expect(screen.getByText('estimating')).toBeInTheDocument();
  });
  it('shows TBD for a one-sided matchup', () => {
    render(<Schedule store={mk([{ matchupId: 1, sides: [side(1, 'Alpha', 0)] }])} />);
    expect(screen.getByText('TBD')).toBeInTheDocument();
    expect(screen.getByText('BYE')).toBeInTheDocument();
    expect(screen.queryByText('0.0')).toBeNull();
    expect(document.body.innerHTML).not.toContain('text-good');
  });
  it('truncates long names with emoji', () => {
    const name = '🏈' + 'x'.repeat(59);
    render(<Schedule store={mk([{ matchupId: 1, sides: [side(1, name, 1), side(2, 'B', 2)] }])} />);
    const el = screen.getByText(name);
    expect(el.className).toContain('truncate');
    expect(el.className).toContain('min-w-0');
  });
  it('shows a message with zero matchups', () => {
    render(<Schedule store={mk([])} />);
    expect(screen.getByText('Week 7 Schedule')).toBeInTheDocument();
    expect(screen.getByText('No matchups this week')).toBeInTheDocument();
  });
  it.each([[3, 2, 2, 'text-4xl'], [6, 3, 2, 'text-3xl'], [9, 3, 3, 'text-3xl'], [10, 3, 4, 'text-2xl'], [16, 4, 4, 'text-xl']])(
    'derives layout for %i matchups',
    (n, cols, rows, text) => {
      const ms = Array.from({ length: n }, (_, i) => ({ matchupId: i, sides: [side(i * 2, `A${i}`, 1), side(i * 2 + 1, `B${i}`, 2)] }));
      render(<Schedule store={mk(ms)} />);
      const grid = screen.getByTestId('schedule-grid');
      expect(grid.getAttribute('style')).toContain(`repeat(${cols}, minmax(0, 1fr))`);
      expect(grid.getAttribute('style')).toContain(`repeat(${rows}, minmax(0, 1fr))`);
      expect(screen.getByText('A0').className).toContain(text);
      expect(grid.children).toHaveLength(n);
    },
  );
});
