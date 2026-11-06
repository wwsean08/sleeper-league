import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EstimatingBadge, ScoresAsOf, StaleBanner, formatClock } from '../../src/web/components/StaleBanner';
import { Layout } from '../../src/web/components/Layout';

describe('StaleBanner', () => {
  it('shows paused only on live pages', () => {
    const { rerender } = render(<StaleBanner status="paused" connected page="spotlight" />);
    expect(screen.getByText('Live feed paused')).toBeInTheDocument();
    rerender(<StaleBanner status="paused" connected page="feed" />);
    expect(screen.getByText('Live feed paused')).toBeInTheDocument();
    rerender(<StaleBanner status="paused" connected page="standings" />);
    expect(screen.queryByText('Live feed paused')).toBeNull();
  });
  it('shows Reconnecting on every page', () => {
    const { rerender } = render(<StaleBanner status="live" connected={false} page="standings" />);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    rerender(<StaleBanner status="live" connected={false} page="spotlight" />);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });
});

describe('StaleBanner while reconnecting the feed', () => {
  it('no paused banner during the very first connect', () => {
    render(<StaleBanner status="connecting" connected page="spotlight" everLive={false} />);
    expect(screen.queryByText('Live feed paused')).toBeNull();
  });
  it('connecting after having been live shows the paused banner on live pages only', () => {
    const { rerender } = render(<StaleBanner status="connecting" connected page="spotlight" everLive />);
    expect(screen.getByText('Live feed paused')).toBeInTheDocument();
    rerender(<StaleBanner status="connecting" connected page="standings" everLive />);
    expect(screen.queryByText('Live feed paused')).toBeNull();
  });
});

describe('ScoresAsOf', () => {
  const t0 = new Date(2026, 10, 8, 19, 42).getTime();
  it('hidden before the first poll and while fresh', () => {
    const { container, rerender } = render(<ScoresAsOf lastPollOkAt={undefined} pollSeconds={60} now={t0 + 999_999} />);
    expect(container.firstChild).toBeNull();
    rerender(<ScoresAsOf lastPollOkAt={t0} pollSeconds={60} now={t0 + 120_000} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows "Scores as of <time>" once older than two poll intervals', () => {
    render(<ScoresAsOf lastPollOkAt={t0} pollSeconds={60} now={t0 + 120_001} />);
    expect(screen.getByTestId('scores-as-of')).toHaveTextContent(`Scores as of ${formatClock(t0)}`);
    expect(formatClock(t0)).toMatch(/7:42/);
  });
});

describe('EstimatingBadge', () => {
  it('renders only when estimating', () => {
    const { container, rerender } = render(<EstimatingBadge estimating={false} />);
    expect(container.firstChild).toBeNull();
    rerender(<EstimatingBadge estimating />);
    expect(screen.getByText('estimating')).toBeInTheDocument();
  });
});

describe('Layout', () => {
  it('renders the header badge on any page', () => {
    render(<Layout leagueName="L" badge={<span>header-badge</span>} />);
    expect(screen.getByText("header-badge")).toBeInTheDocument();
  });
  it('hides the logo when it fails to load', () => {
    const { container } = render(<Layout logo="/logo" leagueName="L" />);
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
  });
});
