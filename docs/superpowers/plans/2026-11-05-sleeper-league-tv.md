# Sleeper League TV Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kiosk-mode league TV display (standings, schedule, rotating Sunday spotlight with big-play takeover, league play feed) driven by Sleeper's REST API and live websocket feed.

**Architecture:** One Node.js + TypeScript process holds the single Sleeper websocket, a pure scoring engine, and in-memory league state. It pushes a full state snapshot plus incremental events to browsers over Server-Sent Events and serves the built web app. The browser (React + Tailwind) is a thin display. REST polling is the fallback whenever the live feed is down.

**Tech Stack:** Node 24, TypeScript, `tsx` (run), `vitest` (tests), `zod` + `yaml` (config), React 18 + Vite + Tailwind CSS 4 (`@tailwindcss/vite`), plain `node:http` + SSE (no server framework).

**Spec:** `docs/superpowers/specs/2026-11-05-sleeper-league-tv-design.md`. Sample frames: `docs/samples/score-nfl-frames-2026-11-05.log`.

## Global Constraints

- Read-only against Sleeper. No writes, no auth on our server, no settings UI; config is a file on disk.
- REST base `https://api.sleeper.app/v1`. Socket URL `wss://gateway.sleeper.com/socket/websocket?token=<JWT>&device_type=web&vsn=2.0.0`; join topic `score:nfl`; frames are `[join_ref, ref, topic, event, payload]`; heartbeat `[null, "<ref>", "phoenix", "heartbeat", {}]` every 20s.
- Do not spoof browser headers or User-Agent to get past blocks. Use the plain Node `WebSocket`/`fetch`.
- Defaults (all config values): rotation 15s per matchup, takeover 8s, takeover queue limit 3, long-gain threshold 40 yards, wait-for-`updated_play` timeout 5s, REST poll 60s.
- Takeover/feed/spotlight cover **starters only** in current-week matchups. Rotation is by matchup (2 teams); only matchups with a starter in a live game, else all matchups.
- Live running score = sum over starters of cumulative `stat_updated` totals scored with the league's `scoring_settings`; never Sleeper's `pts_*`. Play-level `play_stats` only produce the "+points" shown in a takeover. REST matchup `points` is authoritative on each poll.
- The token never reaches the browser or logs. Token comes from config, `SLEEPER_TOKEN` env var, or a secrets file path in config.
- Styling is Tailwind only; theme (colors, fonts, logo) comes from config via CSS variables Tailwind consumes. Ship built CSS, no CDN.
- Performance floor: Raspberry Pi 4. Keep animations to CSS transforms/opacity. Bound memory (keep at most 200 plays).
- A bad config reload keeps the previous good config and logs the error.

## Review Focus

- Bench player scores a TD or a starter is swapped mid-day: no takeover for the bench player; lineup change rebuilds the starter index.
- `new_play` and `updated_play` share a `play_id`: exactly one takeover/feed entry per play; the same play arriving twice is ignored.
- Unknown stat key or unmapped scoring key: logged once, never crashes, contributes 0.
- Socket accepts then closes immediately with code 1005 (what a missing/expired token or unjoined topic did): backoff reconnect, "live feed paused" banner, REST polling keeps scores moving.
- Ten touchdowns in a burst: at most 3 queued, newest/highest-value kept, no overlapping overlays.
- Zero matchups live (Tuesday), bye weeks, an unfilled starter slot (`"0"` player id), tied matchup, very long team name or emoji, missing logo file.
- Browser reconnects after server restart and re-syncs full state without a reload.

---

## File Structure

```
package.json  tsconfig.json  vitest.config.ts  vite.config.ts  .gitignore
config.example.yaml                      # copied to config.local.yaml (git-ignored)
src/shared/types.ts                      # wire + domain types shared by server and web
src/server/config.ts                     # load/validate/reload config
src/server/sleeper/rest.ts               # REST client
src/server/sleeper/socket.ts             # Phoenix client w/ heartbeat + backoff
src/server/scoring.ts                    # pure scoring engine
src/server/league.ts                     # lineups, starter index, standings, schedule, live totals
src/server/plays.ts                      # play assembly, dedupe, classification, takeover queue
src/server/hub.ts                        # SSE fan-out + snapshot
src/server/replay.ts                     # feeds a frames log into the pipeline (tests + dev)
src/server/index.ts                      # wiring + http server + static files
src/web/{main.tsx,store.ts,theme.ts,App.tsx}
src/web/pages/{Standings,Schedule,Spotlight,Feed}.tsx
src/web/components/{Layout,Takeover,StaleBanner}.tsx
test/{config,rest,scoring,league,plays,socket,hub,replay}.test.ts   test/web/*.test.tsx
ops/{kiosk.sh,sleeper-tv.service,README.md}
```

---

### Task 1: Scaffold and config loader

**Files:** Create `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (ignore `node_modules`, `dist`, `config.local.yaml`, `secrets*`, `.superpowers/`), `config.example.yaml`, `src/shared/types.ts` (empty export for now), `src/server/config.ts`, `test/config.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface Config {
    leagueId: string; token?: string;
    theme: { logo?: string; colors: Record<'bg'|'surface'|'text'|'accent'|'good'|'alert', string>; fontFamily: string; };
    rotationSeconds: number; takeoverSeconds: number; takeoverQueueLimit: number;
    longGainYards: number; pollSeconds: number; port: number;
    playlist: Array<'standings'|'schedule'|'spotlight'|'feed'>; playlistSeconds: number;
  }
  export function loadConfig(path: string, env?: NodeJS.ProcessEnv): Config   // throws ConfigError on invalid
  export function watchConfig(path: string, onChange: (c: Config) => void, onError: (e: Error) => void): () => void  // returns stop fn
  ```

- [ ] **Step 1:** `git init`; `npm init`; install `typescript tsx vitest zod yaml` and set scripts (`dev`, `build`, `start`, `test`). Commit.
- [ ] **Step 2: Failing tests** in `test/config.test.ts`: (a) minimal file with only `leagueId` loads with defaults `rotationSeconds===15`, `takeoverSeconds===8`, `takeoverQueueLimit===3`, `longGainYards===40`, `pollSeconds===60`; (b) missing `leagueId` throws `ConfigError`; (c) `SLEEPER_TOKEN` env overrides file token; (d) `tokenFile: path` is read and trimmed; (e) `watchConfig` calls `onChange` after the file is rewritten with `rotationSeconds: 30`, and calls `onError` (not `onChange`) when rewritten with invalid YAML.
- [ ] **Step 3:** Run `npx vitest run test/config.test.ts`, expect FAIL.
- [ ] **Step 4:** Implement with a zod schema; `watchConfig` uses `fs.watch` with a 200ms debounce.
- [ ] **Step 5:** Run tests, expect PASS. Write `config.example.yaml` with every key and comments. Commit.

### Task 2: Shared types and Sleeper REST client

**Files:** Create `src/server/sleeper/rest.ts`; modify `src/shared/types.ts`; test `test/rest.test.ts` (inject `fetch`).

**Interfaces:**
- Produces (types.ts): `Roster {rosterId:number; ownerId:string; teamName:string; avatar?:string; wins:number; losses:number; ties:number; fpts:number; players:string[]; starters:string[]}`, `MatchupSide {rosterId:number; points:number; starters:string[]}`, `Matchup {matchupId:number; sides:[MatchupSide, MatchupSide?]}`, `ScoringSettings = Record<string,number>`, `PlayerInfo {id:string; name:string; position:string; team?:string}`.
- Produces (rest.ts):
  ```ts
  export function createRest(fetchFn?: typeof fetch): {
    nflState(): Promise<{week:number; seasonType:string}>;
    league(id:string): Promise<{name:string; scoringSettings:ScoringSettings; rosterPositions:string[]}>;
    rosters(id:string): Promise<Roster[]>;      // team name from /users metadata.team_name, falls back to display_name
    matchups(id:string, week:number): Promise<Matchup[]>;   // groups by matchup_id; keeps "0" empty-slot starter ids (LeagueState filters them)
    players(): Promise<Map<string,PlayerInfo>>; // cached in memory for 24h
  }
  ```

- [ ] **Step 1: Failing tests** against canned JSON (copy shapes from the real responses described in the spec): rosters merges users so `teamName==="Ty’s Guys"` for the matching owner; matchups groups two rosters by `matchup_id`; a roster with no `metadata.team_name` uses `display_name`; non-200 throws `SleeperHttpError` with `status`.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement (plain `fetch`, no extra headers). **Step 4:** Run, expect PASS. **Step 5:** Commit.

### Task 3: Scoring engine

**Files:** Create `src/server/scoring.ts`; test `test/scoring.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export function scoreStats(stats: Record<string,number>, rules: ScoringSettings, onUnknown?: (key:string)=>void): number
  ```
  Points = sum of `stats[k] * rules[k]` for every `k` present in both. A stat key absent from `rules` calls `onUnknown(k)` once per key per process and contributes 0. Round to 2 decimals.

- [ ] **Step 1: Failing tests** with the real league rules (`sack: 2.5`, `pass_int: -2`, `fgm_40_49: 4`): `{sack:2}` → 5; `{pass_int:1}` → -2; unknown key `zzz` calls `onUnknown("zzz")` exactly once across two calls and returns 0; `{}` → 0; result is rounded (`{x:1}` with rule 0.333 → 0.33).
- [ ] **Step 2-5:** Run fail, implement, run pass, commit.

### Task 4: League state (lineups, standings, schedule, live totals)

**Files:** Create `src/server/league.ts`; test `test/league.test.ts`.

**Interfaces:**
- Consumes: Task 2 types, Task 3 `scoreStats`.
- Produces:
  ```ts
  export class LeagueState {
    constructor(rules: ScoringSettings, players: Map<string,PlayerInfo>)
    loadWeek(week:number, rosters:Roster[], matchups:Matchup[]): void   // rebuilds starter index; returns nothing
    starterOwner(playerId:string): number | undefined                    // rosterId of the roster starting this player this week
    applyStatUpdate(playerId:string, cumulative:Record<string,number>): ScoreChange | undefined  // undefined if not a starter
    reconcile(matchups:Matchup[]): void                                  // REST points snap; sets estimating=true if |live-REST| > 5 on any side
    view(): LeagueView
  }
  export interface ScoreChange { rosterId:number; matchupId:number; playerId:string; playerPoints:number; matchupScores:Record<number,number> }
  export interface LeagueView { week:number; standings:Roster[] /*sorted: wins desc, fpts desc*/; matchups: Array<{matchupId:number; sides:Array<{rosterId:number; teamName:string; score:number; starters:Array<{playerId:string; name:string; position:string; points:number}>}>}>; estimating:boolean }
  ```
  Starter ids `"0"` (empty slot) are ignored. Each side's `score` = REST `points` at load/reconcile, then moves by live deltas (new player total − previous player total).

- [ ] **Step 1: Failing tests** (small fixture league, 2 rosters, 1 matchup): bench player stat update returns `undefined`, no score change; starter update with `{rec_yd:100}` and rule `rec_yd:0.1` raises that side by 10 and returns the new `matchupScores`; a second update with `{rec_yd:120}` adds only +2 (delta, not re-add); `loadWeek` with a swapped starter makes the old starter return `undefined`; `"0"` slot ignored; `reconcile` snaps scores to REST and sets `estimating` when gap > 5; standings sort wins desc then fpts desc, ties kept stable; tied matchup scores both appear.
- [ ] **Step 2-5:** Run fail, implement, run pass, commit.

### Task 5: Play processing (dedupe, classify, takeover queue)

**Files:** Create `src/server/plays.ts`; test `test/plays.test.ts`.

**Interfaces:**
- Consumes: `LeagueState.starterOwner`, `scoreStats`, `Config`.
- Produces:
  ```ts
  export type BigPlayKind = 'touchdown'|'long_gain'|'turnover';
  export interface PlayEntry { playId:string; gameId:string; description:string; quarter:string; clock:string; yards:number; kind?:BigPlayKind; involved:Array<{playerId:string; name:string; rosterId:number; points:number}>; at:number }
  export class PlayPipeline {
    constructor(opts:{league:LeagueState; rules:ScoringSettings; cfg:()=>Config; now?:()=>number; onFeed:(p:PlayEntry)=>void; onTakeover:(p:PlayEntry)=>void})
    handle(event:'new_play'|'updated_play', payload:any): void
    tick(): void   // call every 500ms: releases plays whose stats wait hit 5s, and advances the takeover queue
  }
  ```
  Rules: key by `play_id`. A play is published (feed + maybe takeover) once, when it has at least one `play_stats` entry for a starter **or** 5s have passed since `new_play`; later `updated_play` for an already-published play is ignored. Plays with no starter involved are dropped. Classification (check in this order): `touchdown` if `metadata.is_scoring_play` and any involved starter stat key ends in `_td` or equals `td` with value > 0; `turnover` if any involved starter has any of `pass_int, fum_lost, int, def_td, sack, safe, fum_rec` > 0; `long_gain` if `metadata.yards_gained >= cfg().longGainYards`. Takeover queue: show one at a time for `takeoverSeconds`; hold at most `takeoverQueueLimit` waiting, dropping the lowest-value kind (turnover < long_gain < touchdown), oldest first, when full. Feed keeps the last 200.

- [ ] **Step 1: Failing tests** with a fake clock: bench-only play published nowhere; `new_play` with empty stats then `updated_play` with a starter's stats publishes once, and a repeated `updated_play` publishes nothing; `new_play` with empty stats and no update publishes nothing after 5s because no starter involved; a 62-yard `rec_td` starter play → kind `touchdown` with `points` = `scoreStats(stats, rules)`; 39 yards is not long_gain, 40 is; `pass_int` → turnover; 10 touchdowns in one tick leave exactly 3 queued plus the one showing; next takeover only starts after `takeoverSeconds`; stat keys never seen before do not throw.
- [ ] **Step 2-5:** Run fail, implement, run pass, commit. **Note for implementer:** the stat key names for defensive scores/sacks/safeties are not in the sample capture; keep the key list in one exported constant and log any `play_stats` key not in `scoring_settings` once, so live frames can correct it.

### Task 6: Phoenix socket client and replay harness

**Files:** Create `src/server/sleeper/socket.ts`, `src/server/replay.ts`; tests `test/socket.test.ts`, `test/replay.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type FeedStatus = 'connecting'|'live'|'paused';
  export function createFeed(opts:{url:()=>string|undefined; topic:string; onEvent:(event:string, payload:any)=>void; onStatus:(s:FeedStatus)=>void; WebSocketImpl?:typeof WebSocket; setTimeoutFn?:typeof setTimeout}): {start():void; stop():void}
  export function replayFrames(logText:string, onEvent:(event:string,payload:any)=>void): void   // lines are "<secs> <json frame>"; ignores phx_reply; no delays
  ```
  Behavior: no token (`url()` undefined) → status `paused`, no connection attempts. On open send join; status `live` on the join `phx_reply` with `status:"ok"`. Heartbeat every 20s. On close/error → `paused` and reconnect with backoff 1s, 2s, 4s… capped 60s, reset after the join succeeds. Close code 1005 within 2s of opening counts as a failure (no backoff reset).

- [ ] **Step 1: Failing tests** with a fake WebSocket class: join frame sent on open (`["1","1","score:nfl","phx_join",{}]`); `onStatus('live')` after ok reply; heartbeat sent at 20s of fake time; close → `paused` and reconnect at 1s then 2s; no token → never constructs a socket; replay of the sample log delivers 4 `new_play`, 2 `updated_play`, 6 `stat_updated`, 4 `score_updated` events and none of `phx_reply`.
- [ ] **Step 2-5:** Run fail, implement, run pass, commit.

### Task 7: Hub, HTTP server, and wiring

**Files:** Create `src/server/hub.ts`, `src/server/index.ts`; test `test/hub.test.ts`.

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  export type ServerMessage =
    | {type:'snapshot'; league:LeagueView; feed:PlayEntry[]; takeover:PlayEntry|null; status:FeedStatus; theme:Config['theme']; ui:Pick<Config,'rotationSeconds'|'takeoverSeconds'|'playlist'|'playlistSeconds'>; leagueName:string}
    | {type:'league'; league:LeagueView} | {type:'feed'; play:PlayEntry} | {type:'takeover'; play:PlayEntry} | {type:'status'; status:FeedStatus};
  export class Hub { attach(res:ServerResponse):void; broadcast(m:ServerMessage):void; setSnapshot(fn:()=>ServerMessage):void }
  ```
  HTTP: `GET /events` (SSE; sends snapshot first, comment ping every 15s), `GET /logo` (serves `theme.logo` file or 404), `GET /*` serves `dist/web` with SPA fallback. `index.ts` loads config, polls REST every `pollSeconds` (state, rosters, matchups → `loadWeek`/`reconcile`), starts the feed when a token exists, routes `stat_updated` → `applyStatUpdate` (broadcast `league` on change) and `new_play`/`updated_play` → `PlayPipeline`; runs `tick()` every 500ms; applies config reloads live. If the feed is `paused`, REST polling continues as the only score source.

- [ ] **Step 1: Failing tests** (`node:http` on port 0): a connecting client receives a `snapshot` first; `broadcast` reaches all clients and a client that disconnects is removed without error; snapshot never contains the token string (assert JSON does not include a sentinel token).
- [ ] **Step 2-5:** Run fail, implement, run pass. Manual check: `npm run dev` with a real config prints the SSE stream via `curl -N localhost:<port>/events`. Commit.
- [ ] **Step 6: Replay integration test** in `test/replay.test.ts`: run the sample log through `replayFrames` into a `PlayPipeline`+`LeagueState` built from a small fixture, and assert no throw and that unknown keys are logged, not fatal.

### Task 8: Web shell, theme, store, playlist

**Files:** Create `vite.config.ts`, `index.html`, `src/web/{main.tsx,store.ts,theme.ts,App.tsx}`, `src/web/components/{Layout,StaleBanner}.tsx`; test `test/web/store.test.tsx`, `test/web/theme.test.ts`.

**Interfaces:**
- Produces: `useStore(): {snapshot?:SnapshotMsg; league?; feed:PlayEntry[]; takeover:PlayEntry|null; status:FeedStatus; connected:boolean}` (EventSource with auto-reconnect; on reconnect applies the new snapshot); `applyTheme(theme)` sets CSS variables `--color-bg` etc. and `--font-main` on `:root`, wired into Tailwind via `@theme` so classes like `bg-bg`, `text-accent` exist; `<Layout>` renders logo (`/logo`, hidden if it 404s) upper-left plus children; `<StaleBanner>` shows "Live feed paused" when `status==='paused'` and "Reconnecting…" when `!connected`; `<App>` picks the page by hash route (`#/standings|schedule|spotlight|feed`) or, with no hash, follows `ui.playlist`/`playlistSeconds`, forcing `spotlight` while any matchup has a live starter.

- [ ] **Step 1: Failing tests:** `applyTheme` sets `--color-accent`; store applies a `takeover` message to state and a new `snapshot` replaces everything; playlist chooser returns `spotlight` when live and cycles the configured pages otherwise.
- [ ] **Step 2-5:** Run fail, implement, run pass, commit. Verify `npm run build` produces `dist/web` with a purged CSS file.

### Task 9: Standings and Schedule pages

**Files:** Create `src/web/pages/{Standings,Schedule}.tsx`; tests `test/web/standings.test.tsx`, `test/web/schedule.test.tsx`.

- [ ] **Step 1: Failing tests:** Standings renders rank, team name, `W-L(-T)`, points for, in `LeagueView.standings` order; 18 rows fit without scrolling at 1920×1080 (assert no overflow classes, use compact row height); Schedule renders each matchup's two team names with scores, "TBD" for a one-sided matchup, and a very long team name plus emoji truncates with `truncate`.
- [ ] **Step 2-5:** Run fail, implement with Tailwind classes only, run pass, commit.

### Task 10: Spotlight, Takeover overlay, and Feed

**Files:** Create `src/web/pages/{Spotlight,Feed}.tsx`, `src/web/components/Takeover.tsx`; tests `test/web/spotlight.test.tsx`, `test/web/takeover.test.tsx`, `test/web/feed.test.tsx`.

**Interfaces:**
- Consumes: Task 8 store. `Spotlight` takes `{matchups, rotationSeconds, feed}`; picks matchups with a live starter (a starter with points changed or a play in `feed` within the last 15 minutes) else all.

- [ ] **Step 1: Failing tests:** Spotlight shows both teams, scores, starters with points, and the last 5 feed plays involving those starters; with fake timers it advances to the next matchup after `rotationSeconds`; changing `rotationSeconds` prop changes the interval; zero matchups renders an empty-state message; Takeover shows kind label ("TOUCHDOWN", "LONG GAIN", "TURNOVER"), player, description, `+12.2` points, covers the screen (`fixed inset-0`), and removes itself after `takeoverSeconds`; Feed lists plays newest first, shows team name and points, and is capped at 50 rows on screen.
- [ ] **Step 2-5:** Run fail, implement (CSS transform/opacity animations only), run pass, commit. Push visual polish to a follow-up pass with the user; the brainstorm mockup is layout reference only.

### Task 11: Kiosk operations and docs

**Files:** Create `ops/kiosk.sh`, `ops/sleeper-tv.service`, `ops/README.md`, top-level `README.md`.

- [ ] **Step 1:** `ops/sleeper-tv.service`: systemd unit running `npm start` as a non-root user, `Restart=always`, `EnvironmentFile` for the optional `SLEEPER_TOKEN`. `ops/kiosk.sh`: waits for `http://localhost:<port>`, launches `chromium` with `--kiosk --noerrdialogs --disable-infobars --incognito --autoplay-policy=no-user-gesture-required`, hides the cursor (`unclutter`), disables screen blanking (`xset s off -dpms` for X11; note the Wayland equivalent), and relaunches Chromium if it exits.
- [ ] **Step 2:** `README.md`: install, copy `config.example.yaml` → `config.local.yaml`, how to copy a fresh token from the browser dev tools Network tab (the `gateway.sleeper.com` socket URL's `token=` parameter), token expiry (about every year, shown as the "live feed paused" banner), where the logo file goes, and that Pi 4 is the performance floor.
- [ ] **Step 3: End-to-end check on the target machine (manual, report results):** boot, kiosk shows standings; unplug network 30s and replug → banner appears then clears with no manual action; paste an invalid token → banner stays, REST scores continue; run `npm run replay -- docs/samples/score-nfl-frames-2026-11-05.log` against a fixture league and watch the feed fill. Commit.

---

## Self-Review

- **Spec coverage:** config (T1), REST + pages a/b data (T2, T9), league scoring rules (T3), starters-only + live totals + reconcile (T4), big-play triggers/dedupe/queue (T5), socket/heartbeat/backoff/token-less pause (T6), SSE, token never exposed, fallback polling, live config reload (T7), theme + logo + Tailwind + playlist (T8), page c/d + takeover (T10), kiosk and Pi (T11). Rotation interval is config-driven (T1, T10).
- **Open items carried from the spec, deliberately verified at build time:** exact stat keys for defensive scores/sacks/safeties (T5 note), whether the `league:<id>` topic ever carries events (not used).
- **Type consistency:** `Config`, `LeagueView`, `PlayEntry`, `FeedStatus`, `ServerMessage` are defined once (T1, T4, T5, T6, T7) and reused by name.
