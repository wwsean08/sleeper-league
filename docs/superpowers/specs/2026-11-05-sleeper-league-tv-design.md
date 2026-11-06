# Sleeper League TV Display: Design

Date: 2026-11-05

## Intent

A big-screen "companion display" for a Sleeper fantasy football league. On Sundays the league watches the real games on other TVs while this screen shows what Sleeper's app doesn't show well on a wall: whose matchup is moving, and a loud full-screen moment when a big play lands for a rostered player. It runs unattended (kiosk) on a Raspberry Pi. League members react to it in the room.

Why: the room cares about the league's stakes, not the NFL game itself. The signature moment is the big-play takeover.

## Goals

1. League is configurable (league ID, no hard-coded league).
2. Four pages:
   - **a. Standings:** teams ranked, with wins/losses (and points for/against if available). Sleeper-like content, re-skinned.
   - **b. Schedule:** current week's matchups (both teams, scores if in progress/final). Sleeper-like content, re-skinned.
   - **c. Team spotlight (Sunday mode):** rotates through the league's matchups showing score, starters with live points, and recent plays. Big plays pre-empt the screen.
   - **d. League play feed:** latest plays across the league (rostered players' plays), live.
3. Themeable: colors, fonts, and a custom logo in the upper-left of every page.
4. Kiosk-friendly: boots, shows the page, recovers from network drops and server restarts with nobody touching it.
5. Live scoring uses the league's own scoring rules (not Sleeper's generic `pts_ppr/pts_std`).

## Non-goals

- No auth, no in-browser settings UI. Configuration is a file on disk.
- No editing of the league, lineups, or any write action against Sleeper. Read-only.
- No multi-league / multi-tenant support.
- Not a replacement for the NFL game broadcast (no video, no full game tracker).
- No fully automatic token refresh (see Constraints).

## Anti-goals (failure even if it "works")

- A big-play alert for a play nobody in the league owns (noise).
- Screen stuck on stale data with no indication that it is stale.
- Overlapping/flickering takeovers when plays arrive in a burst.
- Needing someone to SSH in or click anything after boot.

## Data sources (verified 2026-11-05 during a live game)

All verified by hand against live traffic; none are officially documented by Sleeper.

**REST (public, no auth), `https://api.sleeper.app/v1`:**
- `/state/nfl` (current week), `/league/{id}` (includes `scoring_settings` with ~148 keys, `roster_positions`), `/league/{id}/rosters`, `/league/{id}/users`, `/league/{id}/matchups/{week}`, `/players/nfl` (large player dictionary; cache).
- Used for pages a/b, lineups (starters per roster), team names/avatars, and as the cross-check/fallback for matchup totals.

**WebSocket (Phoenix channels v2), requires the user's login JWT:**
- URL: `wss://gateway.sleeper.com/socket/websocket?token=<JWT>&device_type=web&vsn=2.0.0`
- Frames are JSON arrays `[join_ref, ref, topic, event, payload]`.
- Join `["1","1","score:nfl","phx_join",{}]` (the league topic `league:<id>` also joins OK but produced no events in 60s; treat as optional/unknown).
- Send `[null,"<ref>","phoenix","heartbeat",{}]` about every 20s; server replies `phx_reply`.
- Events on `score:nfl` observed:
  - `new_play` / `updated_play`: per-snap. Payload: `play_id`, `game_id`, `week`, `metadata` (`description`, `down`, `distance`, `yard_line`, `yards_gained`, `possession`, `quarter_name`, `time_remaining_*`, `home_points`, `away_points`, `is_scoring_play`, `play_type`, `team`, `opponent`), and `play_stats[]` (`player_id`, `stats{...}`, embedded `player`). `new_play` often arrives with empty `play_stats`; `updated_play` (same `play_id`) fills it in seconds later.
  - `stat_updated`: a player's running weekly raw stats (`player_id`, `week`, `stats{...}`, `team`, `opponent`, `game_id`).
  - `score_updated`: per-game snapshot (scores by quarter, status, clock, down & distance, odds, weather). Includes noisy reaction/view counts to ignore.
- Sample capture used to design this lives in the scratchpad `frames.log` (not part of the repo).

**GraphQL (`https://sleeper.com/graphql`)** is open without auth and has `plays`/`scores`/`game_stats` queries. Not needed in v1; noted as a possible polling fallback. Note: a default Python HTTP client got 403; plain `curl` did not. Do not spoof browser headers to get around blocks.

## Key behaviors

### Scoring engine
Compute each player's fantasy points from raw `stats` using the league's `scoring_settings`, not from Sleeper's `pts_*` fields. Matchup score = sum over **starters** of the roster for that matchup. Initialize from REST `/matchups/{week}`, then update live from `stat_updated` / play stats. Periodically reconcile against REST matchup `points` (assumption: REST is authoritative; the live number is a fast estimate between polls). The "points added by this play" shown in a takeover is the scoring-rules value of that play's `play_stats`.

### Page c: team spotlight
- Rotates by **matchup** (two teams shown at once; 18 teams = 9 matchups). Default 15s per matchup, set by a config value (e.g. `rotationSeconds`) that takes effect on config reload, with no code change needed.
- Shows: both teams' names/logos/owners and live scores, each side's starters with live points, and recent plays involving those starters.
- Rotation includes only matchups with at least one starter in a live (in-progress) game. Falls back to all matchups if none are live. (Builder's call, see below.)

### Big-play takeover
A full-screen interrupt over whatever is on screen, ~8s (configurable), then returns to the prior state.
Triggers, only for plays involving a player who is a **starter** in a current-week league matchup (bench players never trigger):
1. **Touchdown** (`is_scoring_play` + a TD stat on a rostered player).
2. **Long gain**: 40+ yards (`yards_gained >= 40`; threshold configurable).
3. **Turnover / defensive score**: interceptions, fumbles lost, pick-sixes, fumble returns, defensive TDs, safeties, and sacks involving rostered players/DEF.

Not a trigger in v1: matchup-lead changes.
Content: event label, player, play description, which fantasy team(s) it affects, points added, and the new matchup score.
Burst handling: queue takeovers; show them in order, brief each, drop stale ones if the queue grows past a limit (e.g. > 3, keep the newest and the highest-value). Wait for `updated_play` stats (or a short timeout, ~5s) before rendering, so points are known.
Dedupe by `play_id`.

### Page d: league play feed
Reverse-chronological list of plays involving rostered players, with team/owner tags, description, points added. Same deduped play stream as the takeover. Shows plays that did not trigger a takeover.

### Pages a/b
Standings from rosters' `settings` (wins, losses, ties, fpts) and schedule from `/matchups/{week}`. Refreshed by polling (e.g. every 60s, faster on game days). Sleeper-like layout, our theme.

### Theming
Config-defined: logo image (upper-left on every page), color palette, fonts, and per-page options. Takeover styling is part of the theme. v1 ships one polished default theme; the mockup shown during brainstorming is a layout sketch only, and visuals need refinement.

### Configuration and operation
- A config file on disk (e.g. YAML/JSON) plus a folder for assets (logo). Contents: league ID, Sleeper token, theme, rotation timing, takeover thresholds/triggers, page playlist.
- Config reloads without restarting the process (or a documented restart path).
- Token is kept out of anything served to the browser and out of logs, and the config file is git-ignored / mode-restricted.
- Server = single Node.js + TypeScript process: holds the single Sleeper websocket, runs the scoring engine, serves the web pages, and pushes live updates to the browser over its own websocket/SSE. Browser is a thin display.
- Kiosk: Chromium full-screen on boot, auto-reconnect, no cursor, screen-blanking disabled. Provide setup notes/scripts for a Raspberry Pi.

### Failure behavior
- **Token expired/invalid or Sleeper socket down:** exponential-backoff reconnect; pages a/b keep working from REST; pages c/d show a visible "live feed paused" banner; scores fall back to REST polling. Never silently show stale data as live.
- **Browser/server disconnect:** browser auto-reconnects and re-syncs full state.
- The user refreshes the token by pasting a new one into the config (expected about once a year; current token's `exp` is about Aug 2027).

## Constraints

- All Sleeper endpoints other than the public REST API are undocumented and may change without notice.
- The websocket needs the user's personal login token; no known way to refresh it automatically. Treat as a secret.
- Runs on a Raspberry Pi (modest CPU/RAM); the live stream can be bursty during Sunday windows. Keep memory bounded (don't retain unlimited frames).
- Stack: Node.js + TypeScript and Tailwind CSS for styling (both decided with the user). Web UI framework choice (React, Svelte, plain, etc.) left to the builder.

## Decided by the user

- Rotating Sunday page with big-play takeover is the centerpiece.
- Big plays: touchdowns, 40+ yard gains, turnovers/defensive scores. Not matchup swings.
- Pages a, b, d: Sleeper-like content in the same theme.
- Config by file on disk; no auth, no settings UI.
- One Raspberry Pi (or similar) runs everything and shows the page in kiosk mode.
- Token handling: manual paste, with graceful degradation when it lapses.
- Node.js + TypeScript.

- **Starters only** for takeovers, page c, and page d. Bench players never trigger alerts or appear in the feed. Rebuild the player-to-team index from current lineups whenever they change (REST re-poll during game windows).
- **Hardware:** most likely a Raspberry Pi 4, or an Intel NUC or similar x86 mini PC. Not guaranteed to be a Pi. Target a Pi 4 as the performance floor (no Pi 3), keep animations light, and write kiosk setup notes that work on Linux generally, with Pi OS specifics as one case.

- **Styling: Tailwind CSS.** All page styling uses Tailwind. The theme (colors, fonts, logo) should map onto Tailwind's theme configuration or CSS variables it consumes, so the on-disk theme config drives the look without editing component code. Pi-friendly: ship a built/purged CSS file, not a runtime CDN script.

## Left to the builder

- Web UI approach and library, rendering and animation details, exact layouts.
- Config file format and schema, reload mechanism.
- Server-to-browser push mechanism.
- Exact queueing/dedupe rules for takeovers.
- Pi setup scripting (systemd unit, Chromium flags).
- Persistence (probably none; in-memory plus REST re-sync on start).

## Facts added after reviewer questions

- **Sample capture:** a 60-second capture of `score:nfl` is saved at `docs/samples/score-nfl-frames-2026-11-05.log` (one frame per line, prefixed with seconds elapsed; contains no token). Use it as test fixtures and for a replay harness, since the live feed exists only on game days.
- **Defense attribution:** team defense appears in `play_stats` as a team-abbreviation `player_id` (observed `"BAL"` with `rec_tgt`, `"JAX"` with `tkl`/`tkl_solo`). Defensive scores, sacks and safeties are not in the capture; the builder must verify their attribution against live frames before relying on them for takeover triggers.
- **`stat_updated` is cumulative:** it carries a player's running weekly totals. Treat it as the source of truth for the running score; use `play_stats` only to compute the "points added by this play" value for display. If they disagree, the cumulative total wins.
- **Scoring coverage:** implement the scoring keys that the stat feed actually produces, including bonuses/thresholds present in this league's `scoring_settings`; log (not crash on) any scoring key or stat key with no mapping.
- **Page c "recent plays":** plays involving that matchup's starters, most recent ~5. Page d is the league-wide version of the same stream.
- **Live vs REST discrepancy:** snap to REST when polled; if the gap is large, show a small "estimating" indicator instead of animating a jump.
- **Token storage:** config file is the default; also accept it from a separate secrets file or environment variable so a systemd unit can supply it.

## Calls made without the user (check these)

1. Rotation is by matchup (2 teams), ~15s each, live-game matchups only, falling back to all when none live.
2. Takeover duration ~8s, queue limit about 3.
3. (Resolved by the user: starters only, see "Decided by the user".)
4. REST matchup points are authoritative for reconciliation; live number is an estimate.
5. A page playlist in config decides what the kiosk shows when it is not Sunday-live (default: spotlight when games are live, otherwise cycle standings and schedule).
