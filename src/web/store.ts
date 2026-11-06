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
}

export const FEED_MAX = 200;
export const LIVE_WINDOW_MS = 15 * 60 * 1000;

export const initialState: StoreState = { feed: [], takeover: null, status: 'connecting' };

export function reduce(state: StoreState, msg: ServerMessage): StoreState {
  switch (msg.type) {
    case 'snapshot':
      return { snapshot: msg, league: msg.league, feed: [...msg.feed].reverse().slice(0, FEED_MAX), takeover: msg.takeover, status: msg.status };
    case 'league':
      return { ...state, league: msg.league };
    case 'feed':
      return { ...state, feed: [msg.play, ...state.feed].slice(0, FEED_MAX) };
    case 'takeover':
      return { ...state, takeover: msg.play };
    case 'status':
      return { ...state, status: msg.status };
  }
}

/** Matchup ids having a starter involved in a play within the live window. */
export function liveMatchupIds(league: LeagueView | undefined, feed: PlayEntry[], now: number): Set<number> {
  const ids = new Set<number>();
  if (!league) return ids;
  const since = now - LIVE_WINDOW_MS;
  const recent = new Set<string>();
  for (const p of feed) if (p.at >= since) for (const i of p.involved) recent.add(i.playerId);
  for (const m of league.matchups) {
    if (m.sides.some((s) => s.starters.some((st) => recent.has(st.playerId)))) ids.add(m.matchupId);
  }
  return ids;
}

/** True when a recent play involved a player who is a current starter in any matchup. */
export function hasLiveStarters(league: LeagueView | undefined, feed: PlayEntry[], now: number): boolean {
  return liveMatchupIds(league, feed, now).size > 0;
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
