import { useEffect, useReducer, useState } from 'react';
import type { ServerMessage } from '../server/hub';
import type { LeagueView } from '../server/league';
import type { PlayEntry } from '../server/plays';
import type { FeedStatus } from '../server/sleeper/socket';

export type SnapshotMsg = Extract<ServerMessage, { type: 'snapshot' }>;

export interface StoreState {
  snapshot?: SnapshotMsg;
  league?: LeagueView;
  feed: PlayEntry[];
  takeover: PlayEntry | null;
  status: FeedStatus;
  /** Epoch ms of the server's last successful REST poll; undefined before the first one. */
  lastPollOkAt?: number | undefined;
  /** True once the live feed has reported `live` in this page session (survives reconnects). */
  everLive: boolean;
}

export const FEED_MAX = 200;

export const initialState: StoreState = { feed: [], takeover: null, status: 'connecting', everLive: false };

export function reduce(state: StoreState, msg: ServerMessage): StoreState {
  switch (msg.type) {
    case 'snapshot':
      return {
        snapshot: msg,
        league: msg.league,
        lastPollOkAt: msg.lastPollOkAt,
        feed: [...msg.feed].reverse().slice(0, FEED_MAX),
        takeover: msg.takeover,
        status: msg.status,
        everLive: state.everLive || msg.status === 'live',
      };
    case 'league':
      return { ...state, league: msg.league, lastPollOkAt: msg.lastPollOkAt ?? state.lastPollOkAt };
    case 'feed':
      return { ...state, feed: [msg.play, ...state.feed].slice(0, FEED_MAX) };
    case 'takeover':
      return { ...state, takeover: msg.play };
    case 'status':
      return { ...state, status: msg.status, everLive: state.everLive || msg.status === 'live' };
  }
}

/** Scores are stale when the last good REST poll is more than two poll intervals old. */
export function isStale(lastPollOkAt: number | undefined, pollSeconds: number, now: number): boolean {
  if (lastPollOkAt === undefined) return false;
  return now - lastPollOkAt > 2 * pollSeconds * 1000;
}

/**
 * Whether the "Live feed paused" banner applies. `connecting` counts as paused only after the feed
 * has been live once, so a reconnect does not flicker the banner off, but the very first connect
 * does not show it.
 */
export function feedPaused(status: FeedStatus, everLive: boolean): boolean {
  return status === 'paused' || (status === 'connecting' && everLive);
}

/**
 * Matchup ids that are "active": at least one starter's NFL game is in progress. A starter becomes active when
 * their game starts and stops being active when it ends, whether or not any play involved them. The server
 * computes `live` from the feed's game status and clears it if the feed drops.
 */
export function liveMatchupIds(league: LeagueView | undefined): Set<number> {
  const ids = new Set<number>();
  if (!league) return ids;
  for (const m of league.matchups) {
    if (m.sides.some((s) => s.starters.some((st) => st.live))) ids.add(m.matchupId);
  }
  return ids;
}

/** True when any matchup is active (see liveMatchupIds). */
export function hasLiveStarters(league: LeagueView | undefined): boolean {
  return liveMatchupIds(league).size > 0;
}

export const RETRY_MS = 5000;

export function useStore(): StoreState & { connected: boolean } {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const open = () => {
      timer = undefined;
      const cur = new EventSource('/events');
      es = cur;
      cur.onopen = () => setConnected(true);
      cur.onerror = () => {
        setConnected(false);
        // CLOSED means the browser gave up (e.g. HTTP error); recreate it ourselves.
        if (cur.readyState === 2 && !stopped && !timer) {
          cur.close();
          timer = setTimeout(open, RETRY_MS);
        }
      };
      cur.onmessage = (e: MessageEvent<string>) => {
        try {
          dispatch(JSON.parse(e.data) as ServerMessage);
        } catch {
          /* ignore malformed frame */
        }
      };
    };
    open();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);
  return { ...state, connected };
}
