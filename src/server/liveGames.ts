/**
 * Tracks which NFL teams are in a game that is being played right now.
 *
 * A game is active from the moment it starts until it ends, and three independent signals feed that:
 *  - game status, from `score_updated` frames on the live socket or from the public scores poll
 *    (`metadata.status`, `has_started`, `closed`, `home_team`, `away_team`);
 *  - plays: any play frame for a game, even one that involves nobody in the league, proves that game is under way;
 *  - a finished status (the only thing that ENDS a game; a play can start one but can never end one).
 *
 * Statuses go stale after STATUS_TTL_MS without a refresh and play activity after PLAY_TTL_MS of silence, so a
 * lost source cannot leave a team active forever. Time is always passed in so this stays testable.
 */
const FINISHED_STATUSES = new Set(["complete", "closed", "final"]);

/** A status refresh (frame or poll) keeps a game active this long; the 30s poll and frequent frames renew it. */
export const STATUS_TTL_MS = 5 * 60_000;
/** Play-only activity lasts this long after the last play (covers halftime and ordinary delays). */
export const PLAY_TTL_MS = 30 * 60_000;

export function isGameFinished(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return m.closed === true || (typeof m.status === "string" && FINISHED_STATUSES.has(m.status));
}

export function isGameLive(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  return (meta as Record<string, unknown>).has_started === true && !isGameFinished(meta);
}

interface Game {
  teams: readonly string[];
  finished: boolean;
  statusLiveAt?: number; // last time a status said the game was in progress
  lastPlayAt?: number; // last time any play frame arrived for the game
}

const validTeams = (list: unknown[]): string[] => list.filter((t): t is string => typeof t === "string" && t !== "");

export class LiveGames {
  private readonly games = new Map<string, Game>();

  private active(g: Game, now: number): boolean {
    if (g.finished) return false;
    const byStatus = g.statusLiveAt !== undefined && now - g.statusLiveAt <= STATUS_TTL_MS;
    const byPlay = g.lastPlayAt !== undefined && now - g.lastPlayAt <= PLAY_TTL_MS;
    return byStatus || byPlay;
  }

  /** Run a mutation and report whether the set of active teams changed as a result. */
  private changed(now: number, mutate: () => void): boolean {
    const before = [...this.teams(now)].sort().join(",");
    mutate();
    return before !== [...this.teams(now)].sort().join(",");
  }

  /** Feed a game status: a `score_updated` payload or one entry of the scores poll. */
  update(payload: any, now: number): boolean {
    const id = payload?.game_id;
    const meta = payload?.metadata;
    if (id == null || !meta || typeof meta !== "object") return false;
    const teams = validTeams([meta.home_team, meta.away_team]);
    if (teams.length === 0) return false;
    return this.changed(now, () => {
      const g = this.games.get(String(id)) ?? { teams, finished: false };
      g.teams = teams;
      if (isGameFinished(meta)) {
        g.finished = true; // game ids are unique per game: once over, always over
        g.statusLiveAt = undefined;
      } else if (isGameLive(meta)) {
        g.statusLiveAt = now;
      } else {
        g.statusLiveAt = undefined; // not started yet (or odd status): says nothing about plays seen
      }
      this.games.set(String(id), g);
    });
  }

  /** A play frame arrived for a game. `teams` are the play's own team and opponent. */
  markPlay(gameId: unknown, teams: unknown[], now: number): boolean {
    if (gameId == null) return false;
    const id = String(gameId);
    const known = this.games.get(id);
    if (known?.finished) return false;
    const named = validTeams(teams);
    const use = named.length > 0 ? named : (known?.teams ?? []);
    if (use.length === 0) return false;
    return this.changed(now, () => {
      const g = known ?? { teams: use, finished: false };
      if (named.length > 0) g.teams = named;
      g.lastPlayAt = now;
      this.games.set(id, g);
    });
  }

  /** The feed dropped: we can no longer vouch for play-derived activity. Status-derived activity stays. */
  dropPlayActivity(now: number): boolean {
    return this.changed(now, () => {
      for (const g of this.games.values()) g.lastPlayAt = undefined;
    });
  }

  teams(now: number): ReadonlySet<string> {
    const out = new Set<string>();
    for (const g of this.games.values()) if (this.active(g, now)) for (const t of g.teams) out.add(t);
    return out;
  }
}
