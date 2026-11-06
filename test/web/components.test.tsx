import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StaleBanner } from '../../src/web/components/StaleBanner';
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

describe('Layout', () => {
  it('hides the logo when it fails to load', () => {
    const { container } = render(<Layout logo="/logo" leagueName="L" />);
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
  });
});
