import { describe, it, expect, beforeEach } from "vitest";
import { createFeed, type FeedStatus } from "../src/server/sleeper/socket.js";

class FakeWS {
  static instances: FakeWS[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  static throwOnConstruct = false;
  constructor(public url: string) {
    if (FakeWS.throwOnConstruct) throw new Error(`boom ${url}`);
    FakeWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  closeCalls = 0;
  close() {
    this.closeCalls++;
  }
  open() {
    this.onopen?.();
  }
  recv(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

function fakeTime() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const setTimeoutFn = ((fn: () => void, ms: number) => {
    const h = ++id;
    timers.set(h, { at: now + ms, fn });
    return h;
  }) as unknown as typeof setTimeout;
  const clearTimeoutFn = ((h: number) => void timers.delete(h)) as unknown as typeof clearTimeout;
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
  return { setTimeoutFn, clearTimeoutFn, advance };
}

const OK = ["1", "1", "score:nfl", "phx_reply", { response: {}, status: "ok" }];

describe("createFeed", () => {
  let t: ReturnType<typeof fakeTime>;
  let statuses: FeedStatus[];
  let events: [string, any][];
  let token: string | undefined;
  const make = () =>
    createFeed({
      url: () => (token ? `wss://x/?token=${token}` : undefined),
      topic: "score:nfl",
      onEvent: (e, p) => events.push([e, p]),
      onStatus: (s) => statuses.push(s),
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      setTimeoutFn: t.setTimeoutFn,
      clearTimeoutFn: t.clearTimeoutFn,
    });

  beforeEach(() => {
    FakeWS.instances = [];
    FakeWS.throwOnConstruct = false;
    t = fakeTime();
    statuses = [];
    events = [];
    token = "secret";
  });

  it("sends join on open and goes live on ok reply", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    expect(ws.sent[0]).toBe(JSON.stringify(["1", "1", "score:nfl", "phx_join", {}]));
    expect(statuses).toEqual(["connecting"]);
    ws.recv(OK);
    expect(statuses).toEqual(["connecting", "live"]);
    ws.recv([null, null, "score:nfl", "new_play", { a: 1 }]);
    expect(events).toEqual([["new_play", { a: 1 }]]);
  });

  it("sends heartbeat every 20s", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    t.advance(19_999);
    expect(ws.sent.length).toBe(1);
    t.advance(1);
    expect(JSON.parse(ws.sent[1])).toEqual([null, "2", "phoenix", "heartbeat", {}]);
    t.advance(20_000);
    expect(ws.sent.length).toBe(3);
  });

  it("pauses on close and reconnects at 1s then 2s", () => {
    const f = make();
    f.start();
    FakeWS.instances[0].open();
    FakeWS.instances[0].drop(1005);
    expect(statuses.at(-1)).toBe("paused");
    t.advance(999);
    expect(FakeWS.instances.length).toBe(1);
    t.advance(1);
    expect(FakeWS.instances.length).toBe(2);
    FakeWS.instances[1].open();
    FakeWS.instances[1].drop(1005);
    t.advance(1999);
    expect(FakeWS.instances.length).toBe(2);
    t.advance(1);
    expect(FakeWS.instances.length).toBe(3);
  });

  it("resets backoff after a successful join held past 2s", () => {
    const f = make();
    f.start();
    FakeWS.instances[0].open();
    FakeWS.instances[0].drop();
    t.advance(1000);
    FakeWS.instances[1].open();
    FakeWS.instances[1].recv(OK);
    t.advance(3000);
    FakeWS.instances[1].drop();
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(3);
  });

  it("does not reset backoff when closed within 2s of open", () => {
    const f = make();
    f.start();
    FakeWS.instances[0].open();
    FakeWS.instances[0].recv(OK);
    FakeWS.instances[0].drop(1005); // quick failure
    t.advance(1000);
    FakeWS.instances[1].open();
    FakeWS.instances[1].recv(OK);
    FakeWS.instances[1].drop(1005);
    t.advance(1999);
    expect(FakeWS.instances.length).toBe(2);
    t.advance(1);
    expect(FakeWS.instances.length).toBe(3);
  });

  it("caps backoff at 60s", () => {
    const f = make();
    f.start();
    for (let i = 0; i < 10; i++) {
      FakeWS.instances[i].drop();
      t.advance(60_000);
    }
    const n = FakeWS.instances.length;
    FakeWS.instances[n - 1].drop();
    t.advance(59_999);
    expect(FakeWS.instances.length).toBe(n);
    t.advance(1);
    expect(FakeWS.instances.length).toBe(n + 1);
  });

  it("never constructs a socket without a token, and picks one up later", () => {
    token = undefined;
    const f = make();
    f.start();
    t.advance(30_000);
    expect(FakeWS.instances.length).toBe(0);
    expect(statuses).toEqual(["paused"]);
    token = "now";
    t.advance(5000);
    expect(FakeWS.instances.length).toBe(1);
    expect(statuses).toEqual(["paused", "connecting"]);
  });

  it("stop closes and prevents reconnects", () => {
    const f = make();
    f.start();
    FakeWS.instances[0].open();
    f.stop();
    FakeWS.instances[0].drop();
    t.advance(120_000);
    expect(FakeWS.instances.length).toBe(1);
  });

  it("treats a non-ok join reply as failure with backoff", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(["1", "1", "score:nfl", "phx_reply", { response: {}, status: "error" }]);
    expect(statuses.at(-1)).toBe("paused");
    expect(ws.closeCalls).toBe(1);
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(2);
  });

  it.each(["phx_error", "phx_close"])("treats channel %s as failure, not forwarded", (ev) => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(OK);
    ws.recv(["1", null, "score:nfl", ev, {}]);
    expect(events).toEqual([]);
    expect(statuses.at(-1)).toBe("paused");
    expect(ws.closeCalls).toBe(1);
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(2);
  });

  it("survives a throwing constructor and retries with backoff", () => {
    FakeWS.throwOnConstruct = true;
    const f = make();
    f.start();
    expect(statuses.at(-1)).toBe("paused");
    FakeWS.throwOnConstruct = false;
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(1);
  });

  it("survives a throwing heartbeat send", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.send = () => {
      throw new Error("x");
    };
    t.advance(20_000);
    expect(statuses.at(-1)).toBe("paused");
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(2);
  });

  it("onerror then onclose yields exactly one reconnect", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.onerror?.();
    ws.drop();
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(2);
    t.advance(2000);
    expect(FakeWS.instances.length).toBe(2);
  });

  it("ignores messages from a replaced or stopped socket and malformed frames", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(OK);
    expect(() => ws.onmessage?.({ data: "not json" })).not.toThrow();
    expect(events).toEqual([]);
    f.stop();
    ws.recv([null, null, "score:nfl", "new_play", {}]);
    expect(events).toEqual([]);
  });

  it("watchdog: heartbeat replies keep it alive, silence for 45s reconnects", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(OK);
    for (let i = 0; i < 5; i++) {
      t.advance(20_000);
      ws.recv([null, String(i + 2), "phoenix", "phx_reply", { response: {}, status: "ok" }]);
    }
    expect(statuses.at(-1)).toBe("live");
    t.advance(44_999);
    expect(statuses.at(-1)).toBe("live");
    t.advance(1);
    expect(statuses.at(-1)).toBe("paused");
    expect(ws.closeCalls).toBe(1);
    t.advance(1000);
    expect(FakeWS.instances.length).toBe(2);
  });

  it("stop emits paused once, closes the socket, and stops heartbeats", () => {
    const f = make();
    f.start();
    const ws = FakeWS.instances[0];
    ws.open();
    ws.recv(OK);
    f.stop();
    expect(ws.closeCalls).toBe(1);
    expect(statuses.filter((s) => s === "paused").length).toBe(1);
    expect(statuses.at(-1)).toBe("paused");
    const n = ws.sent.length;
    t.advance(60_000);
    expect(ws.sent.length).toBe(n);
  });
});
