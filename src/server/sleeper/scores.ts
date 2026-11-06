/**
 * Per-game status from Sleeper's public GraphQL endpoint. It needs no token and no socket, so it keeps the
 * "which games are being played" signal alive when the live feed is down. Only a content-type header is sent:
 * plain fetch, no spoofed browser headers.
 */
const URL = "https://sleeper.com/graphql";
const TIMEOUT_MS = 15_000;

const QUERY = `query Scores($season: String, $season_type: String, $week: Int) {
  scores(sport: "nfl", season: $season, season_type: $season_type, week: $week) { game_id metadata }
}`;

export interface ScoreGame {
  game_id: string;
  metadata: Record<string, unknown>;
}

export async function fetchScores(
  q: { season: string; seasonType: string; week: number },
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<ScoreGame[]> {
  let res: Response;
  try {
    res = await fetchFn(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { season: q.season, season_type: q.seasonType, week: q.week } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    throw new Error(timedOut ? `Sleeper scores request timed out after ${timeoutMs}ms` : "Sleeper scores request failed");
  }
  if (!res.ok) throw new Error(`Sleeper scores HTTP ${res.status}`);
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error("Sleeper scores returned invalid JSON");
  }
  if (!json?.data && Array.isArray(json?.errors)) throw new Error("Sleeper scores query was rejected");
  const list = json?.data?.scores;
  if (!Array.isArray(list)) return [];
  return list.filter((g: any): g is ScoreGame => g && g.game_id != null && typeof g.metadata === "object" && g.metadata !== null)
    .map((g: ScoreGame) => ({ game_id: String(g.game_id), metadata: g.metadata }));
}
