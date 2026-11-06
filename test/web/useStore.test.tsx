import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStore } from '../../src/web/store';

class FakeES {
  static all: FakeES[] = [];
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}
const open = () => FakeES.all.filter((e) => !e.closed);

beforeEach(() => {
  FakeES.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeES);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useStore connection', () => {
  it('opens one connection, tracks connected, closes on unmount', () => {
    const { result, unmount } = renderHook(() => useStore());
    expect(open()).toHaveLength(1);
    act(() => FakeES.all[0]!.onopen!());
    expect(result.current.connected).toBe(true);
    unmount();
    expect(open()).toHaveLength(0);
  });

  it('recreates the connection 5s after a hard failure, still single', () => {
    const { result, unmount } = renderHook(() => useStore());
    const first = FakeES.all[0]!;
    act(() => {
      first.readyState = 2;
      first.onerror!();
    });
    expect(result.current.connected).toBe(false);
    expect(first.closed).toBe(true);
    act(() => void vi.advanceTimersByTime(4999));
    expect(FakeES.all).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeES.all).toHaveLength(2);
    expect(open()).toHaveLength(1);
    unmount();
    expect(open()).toHaveLength(0);
  });

  it('does not retry manually while the browser is auto-reconnecting, and unmount clears a pending retry', () => {
    const { unmount } = renderHook(() => useStore());
    act(() => {
      FakeES.all[0]!.readyState = 0;
      FakeES.all[0]!.onerror!();
    });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(FakeES.all).toHaveLength(1);
    act(() => {
      FakeES.all[0]!.readyState = 2;
      FakeES.all[0]!.onerror!();
    });
    unmount();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(FakeES.all).toHaveLength(1);
  });
});
