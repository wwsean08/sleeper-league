import type { Matchup, MatchupSide, PlayerInfo, Roster, ScoringSettings } from "../../shared/types.js";

const BASE = "https://api.sleeper.app/v1";
const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;

export class SleeperHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`Sleeper HTTP ${status} for ${url}`);
    this.name = "SleeperHttpError";
  }
}

export interface RestTimeouts {
  /** Per-request timeout for small endpoints (ms). */
  defaultMs: number;
  /** Timeout for the large /players/nfl download (ms). */
  playersMs: number;
}

const DEFAULT_TIMEOUTS: RestTimeouts = { defaultMs: 15_000, playersMs: 60_000 };

export function createRest(
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
  timeouts: RestTimeouts = DEFAULT_TIMEOUTS,
) {
  async function get<T>(path: string, timeoutMs = timeouts.defaultMs): Promise<T> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetchFn(`${BASE}${path}`, { signal });
      if (!res.ok) throw new SleeperHttpError(res.status, path);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof SleeperHttpError) throw e;
      // Plain errors naming only the path; never the full URL or headers.
      if (signal.aborted) throw new Error(`Sleeper request timed out after ${timeoutMs}ms for ${path}`);
      throw new Error(`Sleeper request failed for ${path}: ${String((e as Error)?.message ?? e).split("\n")[0]}`);
    }
  }

  let playersCache: { at: number; value: Map<string, PlayerInfo> } | undefined;

  return {
    async nflState(): Promise<{ week: number; seasonType: string; season: string }> {
      const s = await get<{ week: number; season_type: string; season: string }>("/state/nfl");
      return { week: s.week, seasonType: s.season_type, season: String(s.season) };
    },

    async league(id: string): Promise<{ name: string; scoringSettings: ScoringSettings; rosterPositions: string[] }> {
      const l = await get<{ name: string; scoring_settings: ScoringSettings; roster_positions: string[] }>(
        `/league/${id}`,
      );
      return { name: l.name, scoringSettings: l.scoring_settings ?? {}, rosterPositions: l.roster_positions ?? [] };
    },

    async rosters(id: string): Promise<Roster[]> {
      type RawRoster = {
        roster_id: number;
        owner_id: string | null;
        players?: string[] | null;
        starters?: string[] | null;
        settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number };
      };
      type RawUser = {
        user_id: string;
        display_name: string;
        avatar?: string | null;
        metadata?: { team_name?: string } | null;
      };
      const [rosters, users] = await Promise.all([
        get<RawRoster[]>(`/league/${id}/rosters`),
        get<RawUser[]>(`/league/${id}/users`),
      ]);
      const byId = new Map(users.map((u) => [u.user_id, u]));
      return rosters.map((r) => {
        const owner = r.owner_id ? byId.get(r.owner_id) : undefined;
        const s = r.settings ?? {};
        const teamName = owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`;
        const roster: Roster = {
          rosterId: r.roster_id,
          ownerId: r.owner_id ?? "",
          teamName,
          wins: s.wins ?? 0,
          losses: s.losses ?? 0,
          ties: s.ties ?? 0,
          fpts: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
          players: r.players ?? [],
          starters: r.starters ?? [],
        };
        if (owner?.avatar) roster.avatar = owner.avatar;
        return roster;
      });
    },

    async matchups(id: string, week: number): Promise<Matchup[]> {
      type Raw = { roster_id: number; matchup_id: number | null; points?: number; starters?: string[]; players_points?: Record<string, number> | null };
      const raw = await get<Raw[]>(`/league/${id}/matchups/${week}`);
      const groups = new Map<number, MatchupSide[]>();
      for (const m of raw) {
        if (m.matchup_id == null) continue;
        const side: MatchupSide = { rosterId: m.roster_id, points: m.points ?? 0, starters: m.starters ?? [] };
        if (m.players_points) side.playersPoints = m.players_points;
        const g = groups.get(m.matchup_id);
        if (g) g.push(side);
        else groups.set(m.matchup_id, [side]);
      }
      return [...groups].map(([matchupId, sides]) => ({ matchupId, sides: [sides[0]!, sides[1]] }));
    },

    async players(): Promise<Map<string, PlayerInfo>> {
      if (playersCache && now() - playersCache.at < PLAYERS_TTL_MS) return playersCache.value;
      type Raw = { first_name?: string; last_name?: string; position?: string | null; team?: string | null };
      const raw = await get<Record<string, Raw>>("/players/nfl", timeouts.playersMs);
      const value = new Map<string, PlayerInfo>();
      for (const [pid, p] of Object.entries(raw)) {
        const info: PlayerInfo = {
          id: pid,
          name: [p.first_name, p.last_name].filter(Boolean).join(" ") || pid,
          position: p.position ?? "",
        };
        if (p.team) info.team = p.team;
        value.set(pid, info);
      }
      playersCache = { at: now(), value };
      return value;
    },
  };
}
