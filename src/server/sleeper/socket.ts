export type FeedStatus = "connecting" | "live" | "paused";

const HEARTBEAT_MS = 20_000;
const STABLE_MS = 2_000;
const WATCHDOG_MS = 45_000;
const NO_TOKEN_RETRY_MS = 5_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export function createFeed(opts: {
  url: () => string | undefined;
  topic: string;
  onEvent: (event: string, payload: any) => void;
  onStatus: (s: FeedStatus) => void;
  WebSocketImpl?: typeof WebSocket;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}): { start(): void; stop(): void } {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const setT = opts.setTimeoutFn ?? setTimeout;
  const clearT = opts.clearTimeoutFn ?? clearTimeout;

  let running = false;
  let ws: WebSocket | undefined;
  let status: FeedStatus | undefined;
  let attempt = 0; // consecutive failures; drives backoff
  let hbRef = 1;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let hbTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(s: FeedStatus) {
    if (s === status) return;
    status = s;
    // Never log the URL or token: status and attempt number only.
    console.log(`[feed] ${s} (attempt ${attempt + 1})`);
    opts.onStatus(s);
  }

  function clearConnTimers() {
    if (hbTimer !== undefined) clearT(hbTimer);
    if (stableTimer !== undefined) clearT(stableTimer);
    if (watchdogTimer !== undefined) clearT(watchdogTimer);
    hbTimer = stableTimer = watchdogTimer = undefined;
  }

  function scheduleReconnect(ms: number) {
    if (!running) return;
    if (reconnectTimer !== undefined) clearT(reconnectTimer);
    reconnectTimer = setT(connect, ms);
  }

  function connect() {
    reconnectTimer = undefined;
    if (!running) return;
    const url = opts.url();
    if (!url) {
      setStatus("paused");
      scheduleReconnect(NO_TOKEN_RETRY_MS);
      return;
    }
    setStatus("connecting");
    let joined = false;
    let stable = false;
    let sock: WebSocket;
    try {
      sock = new WS(url);
    } catch {
      console.log("[feed] socket construction failed");
      setStatus("paused");
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
      attempt += 1;
      scheduleReconnect(delay);
      return;
    }
    ws = sock;

    const beat = () => {
      hbRef += 1;
      try {
        sock.send(JSON.stringify([null, String(hbRef), "phoenix", "heartbeat", {}]));
      } catch {
        console.log("[feed] heartbeat send failed");
        onGone();
        return;
      }
      hbTimer = setT(beat, HEARTBEAT_MS);
    };

    let closed = false;
    const onGone = () => {
      if (closed || ws !== sock) return;
      closed = true;
      clearConnTimers();
      ws = undefined;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (!running) return;
      setStatus("paused");
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
      attempt += 1;
      scheduleReconnect(delay);
    };

    const armWatchdog = () => {
      if (watchdogTimer !== undefined) clearT(watchdogTimer);
      watchdogTimer = setT(() => {
        console.log("[feed] watchdog timeout");
        onGone();
      }, WATCHDOG_MS);
    };

    sock.onopen = () => {
      sock.send(JSON.stringify(["1", "1", opts.topic, "phx_join", {}]));
      hbTimer = setT(beat, HEARTBEAT_MS);
      armWatchdog();
      // A close within STABLE_MS of opening counts as a failure (no backoff reset).
      stableTimer = setT(() => {
        stable = true;
        if (joined) attempt = 0;
      }, STABLE_MS);
    };
    sock.onmessage = (e: MessageEvent) => {
      if (!running || ws !== sock) return;
      armWatchdog();
      let frame: unknown;
      try {
        frame = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      const [, , topic, event, payload] = frame as [unknown, unknown, string, string, any];
      if (event === "phx_reply") {
        if (topic === opts.topic && !joined) {
          if (payload?.status === "ok") {
            joined = true;
            if (stable) attempt = 0;
            setStatus("live");
          } else {
            console.log("[feed] join rejected");
            onGone();
          }
        }
        return;
      }
      if (topic === opts.topic && (event === "phx_error" || event === "phx_close")) {
        console.log(`[feed] channel ${event}`);
        onGone();
        return;
      }
      opts.onEvent(event, payload);
    };
    sock.onclose = onGone;
    sock.onerror = onGone;
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0; // a fresh start (e.g. new token) begins at the base backoff
      connect();
    },
    stop() {
      running = false;
      if (reconnectTimer !== undefined) clearT(reconnectTimer);
      reconnectTimer = undefined;
      clearConnTimers();
      const s = ws;
      ws = undefined;
      try {
        s?.close();
      } catch {
        /* ignore */
      }
      setStatus("paused");
    },
  };
}
