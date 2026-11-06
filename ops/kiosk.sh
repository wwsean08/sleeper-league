#!/usr/bin/env bash
# Launch the Sleeper League TV display in a Chromium kiosk and keep it running.
#
# Usage: ops/kiosk.sh [page-hash]
#   ops/kiosk.sh               # automatic page selection
#   ops/kiosk.sh '#/spotlight' # pin one page (#/standings #/schedule #/spotlight #/feed)
#
# Environment:
#   PORT          server port (default 3000; must match `port` in config.local.yaml)
#   LOG_EVERY     while waiting for the server, log a line about every this many seconds (default 30)
#
# The browser is only launched once the server answers; the script waits for it indefinitely.
#
# Run it from the desktop session (autostart), not from systemd, because it needs the display.
# X11: screen blanking is disabled with xset below.
# Wayland (Raspberry Pi OS labwc/Wayland): xset does nothing. Disable blanking in
#   Raspberry Pi Configuration > Display > Screen Blanking (raspi-config: Display Options >
#   Screen Blanking = off), and/or stop swayidle/wayidle in your compositor autostart.
#   unclutter only works under X11; on labwc set the hide-cursor options in rc.xml or use a
#   transparent cursor theme.

PORT="${PORT:-3000}"
LOG_EVERY="${LOG_EVERY:-30}"
RETRY_SECONDS=5
HASH="${1:-}"
URL="http://localhost:${PORT}/${HASH}"
BASE="http://localhost:${PORT}/"

log() { echo "[kiosk] $*" >&2; }

probe() {
  if command -v curl >/dev/null 2>&1; then
    curl -fs -o /dev/null --max-time 3 "$BASE"
  else
    wget -q -O /dev/null -T 3 "$BASE"
  fi
}

# Blocks until the server answers, retrying every RETRY_SECONDS and logging about every LOG_EVERY seconds.
wait_for_server() {
  local waited=0 since_log=0
  while ! probe; do
    if [ "$since_log" -ge "$LOG_EVERY" ] || [ "$waited" -eq 0 ]; then
      log "waiting for the server at ${BASE} (${waited}s so far)"
      since_log=0
    fi
    sleep "$RETRY_SECONDS"
    waited=$((waited + RETRY_SECONDS))
    since_log=$((since_log + RETRY_SECONDS))
  done
  [ "$waited" -gt 0 ] && log "server is up after ${waited}s"
  return 0
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
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  log "neither curl nor wget found; cannot probe the server"
  exit 1
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

# Relaunch Chromium whenever it exits or crashes; never launch it against a dead server.
while true; do
  wait_for_server
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
done
