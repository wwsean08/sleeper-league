import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, watchConfig, type Config } from "./config.js";
import { Hub, FEED_LIMIT, buildSnapshot, createHttpServer } from "./hub.js";
import { LeagueState, type LeagueView } from "./league.js";
import { PlayPipeline, type PlayEntry } from "./plays.js";
import { createRest } from "./sleeper/rest.js";
import { createFeed, type FeedStatus } from "./sleeper/socket.js";
import type { Matchup, PlayerInfo, ScoringSettings } from "../shared/types.js";

const TICK_MS = 500;
const TOPIC = "score:nfl";
const EMPTY_VIEW: LeagueView = { week: 0, standings: [], matchups: [], estimating: false };

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
  let players: Map<string, PlayerInfo> | undefined;
  let league: LeagueState | undefined;
  let pipeline: PlayPipeline | undefined;
  let lastWeek: number | undefined;
  let lastStarters = "";
  let feed: PlayEntry[] = [];
  let takeover: PlayEntry | null = null;
  let takeoverTimer: NodeJS.Timeout | undefined;
  let status: FeedStatus = "paused";

  const view = () => league?.view() ?? EMPTY_VIEW;
  const snapshot = () => buildSnapshot({ league: view(), feed, takeover, status, cfg, leagueName });
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

  let polling = false;
  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    const leagueId = cfg.leagueId;
    const myGen = gen;
    try {
      players ??= await rest.players();
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
      hub.broadcast({ type: "league", league: league.view() });
    } catch (e) {
      console.warn(`[poll] failed, keeping last good state: ${short(e)}`);
    } finally {
      polling = false;
      if (myGen !== gen) void poll(); // re-poll promptly for the new league
    }
  }

  let pollTimer: NodeJS.Timeout | undefined;
  function schedulePoll(): void {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => void poll(), cfg.pollSeconds * 1000);
  }

  function onEvent(event: string, payload: any): void {
    try {
      if (event === "stat_updated") {
        if (!league || payload?.player_id == null || typeof payload.stats !== "object" || !payload.stats) return;
        const change = league.applyStatUpdate(String(payload.player_id), payload.stats);
        if (change) hub.broadcast({ type: "league", league: league.view() });
      } else if (event === "new_play" || event === "updated_play") {
        pipeline?.handle(event, payload);
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
      hub.broadcast({ type: "status", status: s });
    },
  });
  let feedStarted = false;
  function maybeStartFeed(): void {
    if (feedStarted || !cfg.token) return;
    feedStarted = true;
    socket.start();
  }

  const tickTimer = setInterval(() => {
    try {
      pipeline?.tick();
    } catch (e) {
      console.warn(`[tick] ${short(e)}`);
    }
  }, TICK_MS);

  const stopWatch = watchConfig(
    configPath,
    (next) => {
      const prev = cfg;
      cfg = next;
      console.log("[config] reloaded");
      if (next.leagueId !== prev.leagueId) {
        resetLeague();
        feed = [];
        takeover = null;
        void poll();
      }
      if (next.pollSeconds !== prev.pollSeconds) schedulePoll();
      if (next.port !== prev.port) console.log("[config] port change takes effect after restart");
      maybeStartFeed();
      hub.broadcast(snapshot());
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
  maybeStartFeed();

  let stopping = false;
  function shutdown(code = 0): void {
    if (stopping) return;
    stopping = true;
    console.log("[server] shutting down");
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    clearTimeout(takeoverTimer);
    stopWatch();
    socket.stop();
    hub.close();
    server.closeAllConnections();
    server.close(() => process.exit(code));
    setTimeout(() => process.exit(code), 2000).unref();
  }
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main();
