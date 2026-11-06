# Sleeper League TV

A big-screen companion display for a Sleeper fantasy football league. It shows standings and the schedule during the week, and on game days a live team spotlight with a full-screen "takeover" when a big play lands for a starter. It is a small Node server plus a React web UI, meant to run unattended in a Chromium kiosk on a Raspberry Pi 4 or a small Linux mini PC.

## Requirements

- Node 24 and npm
- A Sleeper league id
- Optional: a Sleeper token for the live play feed (see below). Without it, standings, schedule and scores still work from the REST poll.

## Install

```sh
npm ci
npm run build     # type-checks and builds the web UI into dist/web
```

If you skip the build, the server runs but every page returns a plain 404 "Not found".

## Configure

```sh
cp config.example.yaml config.local.yaml
```

`config.local.yaml` is git-ignored. Only `leagueId` is required.

- `leagueId`: the number in your league URL on sleeper.com (`https://sleeper.com/leagues/<leagueId>/...`).
- `theme.logo`: a path or an `http(s)` URL. A relative path resolves against the directory containing the config file, so put `logo.png` next to `config.local.yaml` and set `logo: ./logo.png`.
- `theme.colors` (`bg`, `surface`, `text`, `accent`, `good`, `alert`) and `theme.fontFamily`.
- `rotationSeconds`: seconds per matchup in the spotlight rotation.
- `takeoverSeconds`, `takeoverQueueLimit`, `longGainYards`: how long a big-play takeover shows, how many may queue, and the yardage that counts as a long gain (default 40).
- `pollSeconds`: REST poll interval.
- `port`: HTTP port (default 3000).
- `playlist` and `playlistSeconds`: the pages cycled when no game is live. Options are `standings`, `schedule`, `spotlight`, `feed`.

The server watches the config file and reloads it while running; if a reload fails it keeps the previous config and logs the error. Editing `token` or the `tokenFile` path in the config is picked up live (the feed restarts). A restart is needed only after changing `port`, or after changing `SLEEPER_TOKEN` in the environment or the systemd environment file (the environment is read at process start).

## Sleeper token (live feed)

The live play-by-play uses Sleeper's websocket, which needs your login token.

1. Open sleeper.com in a logged-in browser and open the developer tools Network tab.
2. Filter by WS and reload. Click the `gateway.sleeper.com` socket.
3. Copy the value of the `token=` query parameter from its URL.

Treat it like a password. Provide it one of these ways (precedence in this order):

1. `SLEEPER_TOKEN` environment variable (for systemd, put `SLEEPER_TOKEN=...` in `/etc/sleeper-tv.env`, `chmod 600`).
2. `tokenFile`: a file containing only the token, e.g. `tokenFile: ./secrets.token` (a relative path resolves against the config file's directory, like `theme.logo`), then `chmod 600 secrets.token`.
3. `token` in the config (least preferred).

The token expires roughly once a year. When it lapses (or is invalid), the spotlight and feed pages show a "Live feed paused" banner while standings, schedule and scores keep updating from the REST poll. Paste in a fresh token to recover: if it is in the config, save the file; if it is in `tokenFile`, replace the file contents and then `touch config.local.yaml` (the watcher only watches the config file, not the token file) or restart; if it is `SLEEPER_TOKEN`, update the variable and restart the service.

## Run

```sh
npm start                              # uses config.local.yaml
npm start -- path/to/other-config.yaml # or pass a config path
```

Open `http://<host>:3000/` (use your `port`). Pin a page with the URL hash:

- `/` automatic
- `/#/standings`
- `/#/schedule`
- `/#/spotlight`
- `/#/feed`

## How the pages behave

- With no game live, the screen cycles through the `playlist` every `playlistSeconds`.
- While one of your starters' games is live, the spotlight is forced and rotates through the league's matchups every `rotationSeconds`.
- A pinned hash page (`#/spotlight` etc.) always wins over automatic selection.
- Big-play takeovers are for starters only (bench players never trigger them): touchdowns, a starter's own rushing, receiving or return gain of `longGainYards` or more (kickoffs, punts, field goals and extra points never count as long gains, so a kicker's kick distance never triggers one), and turnovers or defensive scores (interceptions, lost fumbles, defensive touchdowns, safeties, sacks). A play is shown once its frames settle (1.5s without an update, at most 8s after the first frame with a starter's stats), so takeovers land a couple of seconds after the snap. Bursts are queued up to `takeoverQueueLimit`. The defensive stat keys are not yet verified against live frames (see `src/server/plays.ts`).
- The feed page lists recent plays for starters, including ones that did not trigger a takeover.

## Kiosk setup (Raspberry Pi OS / Linux)

Files in `ops/`:

- `sleeper-tv.service`: systemd unit running `npm start` as a non-root user with `Restart=always`.
- `kiosk.sh`: waits for the server (indefinitely, retrying every 5s and logging about every 30s), then launches Chromium fullscreen, hides the cursor, disables screen blanking, and relaunches Chromium if it exits.
- `sleeper-tv-kiosk.desktop`: autostart entry for `kiosk.sh`.

Server as a service:

```sh
sudo useradd --system --create-home sleeper        # or use an existing user
sudo cp -r . /opt/sleeper-league && sudo chown -R sleeper: /opt/sleeper-league
sudo -u sleeper sh -c 'cd /opt/sleeper-league && npm ci && npm run build'   # install and build as the service user
sudo cp ops/sleeper-tv.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now sleeper-tv
journalctl -u sleeper-tv -f
```

To use another location or user, edit `WorkingDirectory`, `User` and `Group` in the unit. The optional `/etc/sleeper-tv.env` supplies `SLEEPER_TOKEN`.

Kiosk browser (needs `chromium` or `chromium-browser`; `unclutter` is optional on X11):

```sh
sudo apt install chromium unclutter
ops/kiosk.sh              # or: ops/kiosk.sh '#/spotlight'
```

`PORT` must match your config if not 3000 (`PORT=8080 ops/kiosk.sh`). Autostart on login:

- X11 / classic Raspberry Pi OS: copy `ops/sleeper-tv-kiosk.desktop` to `~/.config/autostart/` (edit `Exec` to the real path).
- Wayland (labwc): add `/opt/sleeper-league/ops/kiosk.sh &` to `~/.config/labwc/autostart`.

Screen blanking: `kiosk.sh` runs `xset s off; xset -dpms; xset s noblank` on X11. On Wayland that does nothing; turn blanking off in Raspberry Pi Configuration (Display > Screen Blanking) or `raspi-config`. Set the OS to auto-login to the desktop.

Hardware: a Raspberry Pi 4 is the performance floor. Pi 3 is not supported. An Intel NUC-class mini PC works well.

## First-run checklist (do this on your Pi)

The hardware end-to-end check has not been run by the author; please walk through it once on the real device:

1. Reboot: the kiosk should come up showing standings.
2. Unplug the network for about 3 minutes, then replug. While it is out: on spotlight/feed a "Live feed paused" banner appears after the socket's 45s watchdog; on standings/schedule a "Scores as of <time>" badge appears in the header once the last good REST poll is more than two poll intervals old (120s with the default `pollSeconds: 60`). After replugging, both clear on their own with no manual action.
3. Put an invalid token in and restart: the spotlight and feed pages show "Live feed paused" while standings and scores continue from the REST poll.

## Troubleshooting

- "Not found" page instead of the display: the server returns a plain 404 "Not found" when `dist/web` is missing; run `npm run build` (as the service user).
- "Scores as of <time>" badge: the REST poll has not succeeded for more than two poll intervals (network or Sleeper outage). Scores shown are from that time; it clears after the next good poll.
- "estimating" badge (spotlight/schedule): the live score drifted more than 5 points from Sleeper's REST total at the last poll; the REST value is shown and the badge clears once they agree.
- "Reconnecting...": the browser lost its connection to the server; it recovers on its own when the server is back.
- "Live feed paused": no valid token, or the Sleeper socket is down. The server reconnects with backoff; a bad or expired token needs replacing. REST-based data keeps updating.
- Server exits at start: config error (printed on stderr), commonly a missing `config.local.yaml` or `leagueId`.
- Check a captured frame log parses: `npm run replay -- docs/samples/score-nfl-frames-2026-11-05.log` (prints a count per event type; it does not drive the display).
- Tests: `npm test`.

## Security

There is no authentication by design. The server binds all interfaces (`0.0.0.0`) on `port`, so anyone on your network can open the display. Keep it on a trusted LAN or firewall the port. Never commit `config.local.yaml`, `secrets*` files or tokens (they are git-ignored). The token is read only by the server and is never sent to the browser.

The Sleeper endpoints this uses are undocumented and may change or break without notice.
