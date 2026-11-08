import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, watchConfig, type Config } from "./config.js";
import { Hub, FEED_LIMIT, buildSnapshot, createHttpServer } from "./hub.js";
import { LeagueState } from "./league.js";
import { LiveGames } from "./liveGames.js";
import { PlayPipeline, type PlayEntry } from "./plays.js";
import { createRest } from "./sleeper/rest.js";
import { fetchScores } from "./sleeper/scores.js";
import { createFeed, type FeedStatus } from "./sleeper/socket.js";
import type { Matchup, PlayerInfo, ScoringSettings } from "../shared/types.js";

const TICK_MS = 500;
const TOPIC = "score:nfl";
const SCORES_POLL_MS = 30_000;
const ESTIMATING_POLL_MS = 10_000; // re-check REST this often while scores are flagged "estimating"

/** First line of an error message only; never includes request URLs with secrets (REST has none). */
const short = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0];

const startersKey = (ms: Matchup[]) =>
  JSON.stringify(
    [...ms]
      .sort((a, b) => a.matchupId - b.matchupId)
      .map((m) => m.sides.map((s) => (s ? [s.rosterId, s.starters] : null))),
  );

function main(): void {
  const configPath = path.resolve(process.argv[2] ?? "config.local.yaml");
  let cfg: Config;
  try {
    cfg = loadConfig(configPath);
  } catch (e) {
    console.error(short(e));
    process.exit(1);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = path.resolve(here, "../../dist/web");
  const rest = createRest();
  const hub = new Hub();

  let leagueName = "";
  let rules: ScoringSettings | undefined;
  // Empty until /players/nfl loads in the background; LeagueState falls back to ids meanwhile.
  let players = new Map<string, PlayerInfo>();
  let league: LeagueState | undefined;
  let pipeline: PlayPipeline | undefined;
  let lastWeek: number | undefined;
  let lastStarters = "";
  let feed: PlayEntry[] = [];
  let takeover: PlayEntry | null = null;
  let takeoverTimer: NodeJS.Timeout | undefined;
  let status: FeedStatus = "paused";
  const liveGames = new LiveGames();
  let lastPollOkAt: number | undefined; // epoch ms of the last successful REST poll

  // No league view until the first successful load: clients show "Waiting for league data…".
  const snapshot = () => buildSnapshot({ league: league?.view(), lastPollOkAt, feed, takeover, status, cfg, leagueName });
  const broadcastLeague = (l: LeagueState) => hub.broadcast({ type: "league", league: l.view(), lastPollOkAt });
  hub.setSnapshot(snapshot);

  let gen = 0; // bumped when the league changes so in-flight polls discard their results
  function resetLeague(): void {
    gen += 1;
    leagueName = "";
    rules = undefined;
    league = undefined;
    pipeline = undefined;
    lastWeek = undefined;
    lastStarters = "";
    lastPollOkAt = undefined;
  }

  function onFeed(p: PlayEntry): void {
    feed.push(p);
    if (feed.length > FEED_LIMIT) feed = feed.slice(-FEED_LIMIT);
    hub.broadcast({ type: "feed", play: p });
  }

  function onTakeover(p: PlayEntry): void {
    takeover = p;
    hub.broadcast({ type: "takeover", play: p });
    clearTimeout(takeoverTimer);
    takeoverTimer = setTimeout(() => {
      if (takeover === p) takeover = null;
    }, cfg.takeoverSeconds * 1000);
  }

  let playersLoading = false;
  /** Fire-and-forget; rest.players() is TTL-cached (24h), so calling it every poll refreshes names daily. */
  function refreshPlayers(): void {
    if (playersLoading) return;
    playersLoading = true;
    rest
      .players()
      .then((m) => {
        if (m === players) return;
        players = m;
        if (league) {
          league.setPlayers(m);
          broadcastLeague(league);
        }
      })
      .catch((e) => console.warn(`[players] load failed, will retry next poll: ${short(e)}`))
      .finally(() => {
        playersLoading = false;
      });
  }

  let polling = false;
  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    const leagueId = cfg.leagueId;
    const myGen = gen;
    refreshPlayers();
    try {
      const { week } = await rest.nflState();
      if (!rules) {
        const meta = await rest.league(leagueId);
        if (myGen !== gen) return;
        leagueName = meta.name;
        rules = meta.scoringSettings;
      }
      const [rosters, matchups] = await Promise.all([rest.rosters(leagueId), rest.matchups(leagueId, week)]);
      if (myGen !== gen || !rules) return; // league changed mid-poll; results are stale
      if (!league) {
        league = new LeagueState(rules, players);
        league.setLiveTeams(liveGames.teams(Date.now()));
        pipeline = new PlayPipeline({ league, rules, cfg: () => cfg, onFeed, onTakeover });
      }
      const key = startersKey(matchups);
      if (lastWeek === undefined || week !== lastWeek || key !== lastStarters) {
        league.loadWeek(week, rosters, matchups);
      } else {
        league.reconcile(matchups, rosters);
      }
      lastWeek = week;
      lastStarters = key;
      lastPollOkAt = Date.now();
      broadcastLeague(league);
    } catch (e) {
      console.warn(`[poll] failed, keeping last good state: ${short(e)}`);
    } finally {
      polling = false;
      if (myGen !== gen) void poll(); // re-poll promptly for the new league
      else scheduleEstimatingRecheck();
    }
  }

  // Game status from Sleeper's public scores query. Needs no token and no socket, so it keeps "which games are
  // being played" accurate even when the live feed is down.
  let scoresPolling = false;
  let scoresFailing = false;
  async function pollScores(): Promise<void> {
    if (scoresPolling) return;
    scoresPolling = true;
    try {
      const { week, seasonType, season } = await rest.nflState();
      const games = await fetchScores({ season, seasonType, week });
      const now = Date.now();
      for (const g of games) liveGames.update(g, now);
      syncLiveTeams();
      scoresFailing = false;
    } catch (e) {
      if (!scoresFailing) console.warn(`[scores] failed, will keep retrying: ${short(e)}`); // log once per outage
      scoresFailing = true;
    } finally {
      scoresPolling = false;
    }
  }

  // While the league is flagged "estimating", poll faster than pollSeconds so the badge clears soon after REST catches up.
  let recheckTimer: NodeJS.Timeout | undefined;
  function scheduleEstimatingRecheck(): void {
    if (recheckTimer || !league?.isEstimating()) return;
    recheckTimer = setTimeout(() => {
      recheckTimer = undefined;
      void poll();
    }, Math.min(ESTIMATING_POLL_MS, cfg.pollSeconds * 1000));
  }

  let pollTimer: NodeJS.Timeout | undefined;
  function schedulePoll(): void {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => void poll(), cfg.pollSeconds * 1000);
  }

  // Push the current live-game teams into the league view and tell the browsers if anything changed.
  function syncLiveTeams(): void {
    if (league?.setLiveTeams(liveGames.teams(Date.now()))) broadcastLeague(league);
  }

  function onEvent(event: string, payload: any): void {
    try {
      if (event === "stat_updated") {
        if (!league || payload?.player_id == null || typeof payload.stats !== "object" || !payload.stats) return;
        const change = league.applyStatUpdate(String(payload.player_id), payload.stats, payload.week);
        if (change) broadcastLeague(league);
      } else if (event === "new_play" || event === "updated_play") {
        pipeline?.handle(event, payload);
        // Any play frame, even one involving nobody in the league, proves that game is under way.
        liveGames.markPlay(payload?.game_id, [payload?.metadata?.team, payload?.metadata?.opponent], Date.now());
        syncLiveTeams();
      } else if (event === "score_updated") {
        if (liveGames.update(payload, Date.now())) syncLiveTeams();
      }
    } catch (e) {
      console.warn(`[feed] ${event} handling failed: ${short(e)}`);
    }
  }

  const socket = createFeed({
    // The token only ever lives inside this URL, built on demand and never logged.
    url: () =>
      cfg.token
        ? `wss://gateway.sleeper.com/socket/websocket?token=${encodeURIComponent(cfg.token)}&device_type=web&vsn=2.0.0`
        : undefined,
    topic: TOPIC,
    onEvent,
    onStatus: (s) => {
      status = s;
      // Without the feed we cannot vouch that any game is still live, so drop the highlight.
      if (s !== "live" && liveGames.dropPlayActivity(Date.now())) syncLiveTeams();
      hub.broadcast({ type: "status", status: s });
    },
  });
  let feedRunning = false;
  function maybeStartFeed(): void {
    if (feedRunning || !cfg.token) return;
    feedRunning = true;
    socket.start();
  }
  function stopFeed(): void {
    if (!feedRunning) return;
    feedRunning = false;
    socket.stop(); // reports status "paused"
  }

  const tickTimer = setInterval(() => {
    try {
      pipeline?.tick();
      syncLiveTeams(); // activity expires with time, so re-check every tick
    } catch (e) {
      console.warn(`[tick] ${short(e)}`);
    }
  }, TICK_MS);

  const stopWatch = watchConfig(
    configPath,
    (next) => {
      const prev = cfg;
      cfg = next; // loadConfig already validated it; from here on the new config is live
      try {
        if (next.leagueId !== prev.leagueId) {
          resetLeague();
          feed = [];
          takeover = null;
          void poll();
        }
        if (next.pollSeconds !== prev.pollSeconds) schedulePoll();
        if (next.port !== prev.port) console.log("[config] port change takes effect after restart");
        if (next.token !== prev.token) {
          stopFeed(); // restart with the new token, or stay paused if it was removed
          console.log("[config] token changed; feed restarting");
        }
        maybeStartFeed();
        hub.broadcast(snapshot());
        console.log("[config] reloaded");
      } catch (e) {
        console.error(`[config] reload applied with errors: ${short(e)}`);
      }
    },
    (e) => console.error(`[config] reload failed, keeping previous config: ${short(e)}`),
  );

  const server = createHttpServer({
    hub,
    webRoot,
    logoPath: () => {
      const logo = cfg.theme.logo;
      if (!logo) return undefined;
      if (/^https?:\/\//i.test(logo)) return logo;
      return path.resolve(path.dirname(configPath), logo);
    },
  });
  server.on("error", (e) => {
    console.error(`[http] ${short(e)}`);
    shutdown(1);
  });
  server.listen(cfg.port, "0.0.0.0", () => console.log(`[http] listening on http://0.0.0.0:${cfg.port}`));

  void poll();
  schedulePoll();
  void pollScores();
  const scoresTimer = setInterval(() => void pollScores(), SCORES_POLL_MS);
  maybeStartFeed();

  let stopping = false;
  function shutdown(code = 0): void {
    if (stopping) return;
    stopping = true;
    console.log("[server] shutting down");
    clearInterval(pollTimer);
    clearTimeout(recheckTimer);
    clearInterval(tickTimer);
    clearInterval(scoresTimer);
    clearTimeout(takeoverTimer);
    stopWatch();
    stopFeed();
    hub.close();
    server.closeAllConnections();
    server.close(() => process.exit(code));
    setTimeout(() => process.exit(code), 2000).unref();
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main();
