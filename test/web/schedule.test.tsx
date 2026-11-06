import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Schedule } from '../../src/web/pages/Schedule';
import type { StoreState } from '../../src/web/store';

const side = (rosterId: number, teamName: string, score: number) => ({ rosterId, teamName, score, starters: [] });
function mk(matchups: unknown[]): StoreState {
  return { league: { week: 7, standings: [], matchups, estimating: false }, feed: [], status: 'live', connected: true } as unknown as StoreState;
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
  it('shows TBD for a one-sided matchup', () => {
    render(<Schedule store={mk([{ matchupId: 1, sides: [side(1, 'Alpha', 0)] }])} />);
    expect(screen.getByText('TBD')).toBeInTheDocument();
  });
  it('truncates long names with emoji', () => {
    const name = '🏈' + 'x'.repeat(59);
    render(<Schedule store={mk([{ matchupId: 1, sides: [side(1, name, 1), side(2, 'B', 2)] }])} />);
    const el = screen.getByText(name);
    expect(el.className).toContain('truncate');
    expect(el.className).toContain('min-w-0');
  });
});
