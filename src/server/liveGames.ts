/**
 * Tracks which NFL games are in progress, from `score_updated` frames on the `score:nfl` topic.
 * A frame's metadata carries `status` ("inprogress" in the sample capture), `has_started`, `closed`,
 * `home_team` and `away_team`. The other status strings are not all verified, so "live" is defined by
 * exclusion: started, not closed, and not one of the known finished statuses.
 */
const FINISHED_STATUSES = new Set(["complete", "closed", "final"]);

export function isGameLive(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  if (m.has_started !== true || m.closed === true) return false;
  return !(typeof m.status === "string" && FINISHED_STATUSES.has(m.status));
}

export class LiveGames {
  private readonly games = new Map<string, readonly string[]>(); // game_id -> [home, away] while live

  /** Feed one `score_updated` payload. Returns true when the set of live teams changed. */
  update(payload: any): boolean {
    const id = payload?.game_id;
    const meta = payload?.metadata;
    if (id == null || !meta || typeof meta !== "object") return false;
    const teams = [meta.home_team, meta.away_team].filter((t): t is string => typeof t === "string" && t !== "");
    if (teams.length === 0) return false;
    const key = String(id);
    const before = this.games.get(key);
    if (isGameLive(meta)) {
      if (before && before.length === teams.length && before.every((t, i) => t === teams[i])) return false;
      this.games.set(key, teams);
      return true;
    }
    return this.games.delete(key);
  }

  teams(): ReadonlySet<string> {
    return new Set([...this.games.values()].flat());
  }

  /** Forget everything (e.g. the feed dropped, so we can no longer vouch for any game being live). */
  clear(): boolean {
    const had = this.games.size > 0;
    this.games.clear();
    return had;
  }
}
