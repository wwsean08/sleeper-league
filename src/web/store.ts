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
      return { snapshot: msg, league: msg.league, feed: msg.feed.slice(-FEED_MAX), takeover: msg.takeover, status: msg.status };
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

/** True when a recent play involved a player who is a current starter in any matchup. */
export function hasLiveStarters(league: LeagueView | undefined, feed: PlayEntry[], now: number): boolean {
  if (!league) return false;
  const starters = new Set<string>();
  for (const m of league.matchups) for (const side of m.sides) for (const st of side.starters) starters.add(st.playerId);
  const since = now - LIVE_WINDOW_MS;
  return feed.some((p) => p.at >= since && p.involved.some((i) => starters.has(i.playerId)));
}

export function useStore(): StoreState & { connected: boolean } {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource('/events');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        dispatch(JSON.parse(e.data) as ServerMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
  }, []);
  return { ...state, connected };
}
