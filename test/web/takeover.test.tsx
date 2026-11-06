import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Takeover } from '../../src/web/components/Takeover';

const league = {
  week: 1, standings: [], estimating: false,
  matchups: [{ matchupId: 1, sides: [
    { rosterId: 1, teamName: 'Alpha', score: 101.25, starters: [] },
    { rosterId: 2, teamName: 'Beta', score: 90, starters: [] },
  ] }],
} as never;
const play = (id: string, over: Record<string, unknown> = {}) => ({
  playId: id, gameId: 'g', description: 'Long bomb to the end zone', quarter: '3', clock: '2:11', yards: 54, kind: 'touchdown',
  involved: [
    { playerId: 'a', name: 'Ann Ace', rosterId: 1, points: 12.2 },
    { playerId: 'b', name: 'Bit Part', rosterId: 1, points: 0.1 },
  ],
  at: 0, ...over,
}) as never;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Takeover', () => {
  it('shows label, player, description, points, team, score', () => {
    const { container } = render(<Takeover play={play('p1')} seconds={8} league={league} />);
    expect(screen.getByText('TOUCHDOWN')).toBeInTheDocument();
    expect(screen.getByText('Ann Ace')).toBeInTheDocument();
    expect(screen.getByText('Long bomb to the end zone')).toBeInTheDocument();
    expect(screen.getByText('+12.3')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('101.3')).toBeInTheDocument();
    expect(screen.getByText(/54/)).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toContain('fixed inset-0');
  });
  it("shows both sides of the affected matchup, highlighting the involved side", () => {
    render(<Takeover play={play('p1')} seconds={8} league={league} />);
    expect(screen.getAllByTestId('takeover-matchup')).toHaveLength(1);
    const sides = screen.getAllByTestId('takeover-side');
    expect(sides.map((s) => s.getAttribute('data-involved'))).toEqual(['true', 'false']);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('90.0')).toBeInTheDocument();
    expect(sides[1]!.className).toContain('opacity-60');
  });
  it('points are text-good when non-negative and text-alert when negative', () => {
    render(<Takeover play={play('p1')} seconds={8} league={league} />);
    expect(screen.getByText('+12.3').className).toContain('text-good');
    cleanup();
    render(<Takeover play={play('p2', { kind: 'turnover', involved: [{ playerId: 'q', name: 'Q B', rosterId: 2, points: -2 }] })} seconds={8} league={league} />);
    const pts = screen.getByText('-2.0');
    expect(pts.className).toContain('text-alert');
    expect(pts.className).not.toContain('text-good');
  });
  it('labels other kinds', () => {
    render(<Takeover play={play('p2', { kind: 'long_gain' })} seconds={8} league={league} />);
    expect(screen.getByText('LONG GAIN')).toBeInTheDocument();
    cleanup();
    render(<Takeover play={play('p3', { kind: 'turnover' })} seconds={8} league={league} />);
    expect(screen.getByText('TURNOVER')).toBeInTheDocument();
    cleanup();
    render(<Takeover play={play('p4', { kind: undefined })} seconds={8} league={league} />);
    expect(screen.getByText('BIG PLAY')).toBeInTheDocument();
  });
  it('dismisses after seconds, not re-shown on re-render, restarts for new playId', () => {
    const p = play('p1');
    const { container, rerender } = render(<Takeover play={p} seconds={8} league={league} />);
    act(() => void vi.advanceTimersByTime(7999));
    expect(container.firstChild).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(container.firstChild).toBeNull();
    rerender(<Takeover play={p} seconds={8} league={league} />);
    expect(container.firstChild).toBeNull();
    rerender(<Takeover play={play('p2')} seconds={8} league={league} />);
    expect(container.firstChild).not.toBeNull();
    act(() => void vi.advanceTimersByTime(8000));
    expect(container.firstChild).toBeNull();
  });
  it('a new play mid-display restarts the timer', () => {
    const { container, rerender } = render(<Takeover play={play('p1')} seconds={8} league={league} />);
    act(() => void vi.advanceTimersByTime(5000));
    rerender(<Takeover play={play('p2')} seconds={8} league={league} />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(container.firstChild).not.toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(container.firstChild).toBeNull();
  });
  it('clears timer on unmount', () => {
    const { unmount } = render(<Takeover play={play('p1')} seconds={8} league={league} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
