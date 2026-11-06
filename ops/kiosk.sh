#!/usr/bin/env bash
# Launch the Sleeper League TV display in a Chromium kiosk and keep it running.
#
# Usage: ops/kiosk.sh [page-hash]
#   ops/kiosk.sh               # automatic page selection
#   ops/kiosk.sh '#/spotlight' # pin one page (#/standings #/schedule #/spotlight #/feed)
#
# Environment:
#   PORT          server port (default 3000; must match `port` in config.local.yaml)
#   WAIT_SECONDS  how long to wait for the server before giving up (default 120)
#
# Run it from the desktop session (autostart), not from systemd, because it needs the display.
# X11: screen blanking is disabled with xset below.
# Wayland (Raspberry Pi OS labwc/Wayland): xset does nothing. Disable blanking in
#   Raspberry Pi Configuration > Display > Screen Blanking (raspi-config: Display Options >
#   Screen Blanking = off), and/or stop swayidle/wayidle in your compositor autostart.
#   unclutter only works under X11; on labwc set the hide-cursor options in rc.xml or use a
#   transparent cursor theme.

PORT="${PORT:-3000}"
WAIT_SECONDS="${WAIT_SECONDS:-120}"
HASH="${1:-}"
URL="http://localhost:${PORT}/${HASH}"
BASE="http://localhost:${PORT}/"

log() { echo "[kiosk] $*" >&2; }

wait_for_server() {
  local waited=0
  while [ "$waited" -lt "$WAIT_SECONDS" ]; do
    if command -v curl >/dev/null 2>&1; then
      curl -fs -o /dev/null --max-time 3 "$BASE" && return 0
    elif command -v wget >/dev/null 2>&1; then
      wget -q -O /dev/null -T 3 "$BASE" && return 0
    else
      log "neither curl nor wget found; cannot probe the server"
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

find_browser() {
  local b
  for b in chromium-browser chromium google-chrome; do
    if command -v "$b" >/dev/null 2>&1; then
      echo "$b"
      return 0
    fi
  done
  return 1
}

BROWSER="$(find_browser)" || { log "no chromium-browser, chromium or google-chrome found"; exit 1; }

if ! wait_for_server; then
  log "server at ${BASE} did not answer within ${WAIT_SECONDS}s; launching the browser anyway (Chromium shows an error page until the app is reachable; the page's own reconnect recovers once the server is up)"
fi

# X11 only: no screen saver / DPMS blanking.
if [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null 2>&1; then
  xset s off
  xset -dpms
  xset s noblank
fi

# X11 only: hide the mouse cursor.
if [ -n "${DISPLAY:-}" ] && command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.1 -root &
  UNCLUTTER_PID=$!
fi

UNCLUTTER_PID="${UNCLUTTER_PID:-}"
CHROME_PID=""
cleanup() {
  trap - EXIT
  [ -n "$CHROME_PID" ] && kill "$CHROME_PID" 2>/dev/null
  [ -n "$UNCLUTTER_PID" ] && kill "$UNCLUTTER_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Relaunch Chromium whenever it exits or crashes.
while true; do
  "$BROWSER" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --incognito \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --disable-features=TranslateUI \
    "$URL" &
  CHROME_PID=$!
  wait "$CHROME_PID"
  log "browser exited (status $?); relaunching in 5s"
  CHROME_PID=""
  sleep 5
  # If the server is down, wait for it again before relaunching.
  wait_for_server || true
done
