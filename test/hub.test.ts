import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Hub, createHttpServer, buildSnapshot, type ServerMessage } from "../src/server/hub.js";
import type { Config } from "../src/server/config.js";
import type { LeagueView } from "../src/server/league.js";

const SENTINEL = "SENTINEL_TOKEN_9f8e7d";
const cfg: Config = {
  leagueId: "123",
  token: SENTINEL,
  theme: {
    colors: { bg: "#000", surface: "#111", text: "#fff", accent: "#f00", good: "#0f0", alert: "#f00" },
    fontFamily: "system-ui",
  },
  rotationSeconds: 15,
  takeoverSeconds: 8,
  takeoverQueueLimit: 3,
  longGainYards: 40,
  pollSeconds: 60,
  port: 0,
  playlist: ["standings"],
  playlistSeconds: 20,
};
const league: LeagueView = { week: 1, standings: [], matchups: [], estimating: false };
const snap = (): ServerMessage =>
  buildSnapshot({ league, feed: [], takeover: null, status: "paused", cfg, leagueName: "L" });

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function start(opts: { pingMs?: number; webRoot?: string; logoPath?: () => string | undefined } = {}) {
  const hub = new Hub({ pingMs: opts.pingMs });
  hub.setSnapshot(snap);
  const webRoot = opts.webRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "hubweb-"));
  const server = createHttpServer({ hub, webRoot, logoPath: opts.logoPath ?? (() => undefined) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  cleanup.push(() => {
    hub.close();
    server.closeAllConnections();
    server.close();
  });
  return { hub, server, port };
}

/** Opens an SSE stream and collects raw text. */
function sse(port: number) {
  let text = "";
  let req!: http.ClientRequest;
  const ready = new Promise<http.IncomingMessage>((resolve) => {
    req = http.get({ host: "127.0.0.1", port, path: "/events" }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (d: string) => (text += d));
      res.on("error", () => {});
      resolve(res);
    });
    req.on("error", () => {});
  });
  const messages = () =>
    text
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)) as ServerMessage);
  return { ready, messages, raw: () => text, close: () => req.destroy() };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
};

function get(port: number, p: string): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    // http.request sends the path verbatim, so traversal sequences reach the server unnormalised.
    http
      .request({ host: "127.0.0.1", port, path: p }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode!, type: String(res.headers["content-type"] ?? ""), body }));
      })
      .on("error", reject)
      .end();
  });
}

describe("Hub + SSE", () => {
  it("sends the snapshot first with SSE headers", async () => {
    const { port } = await start();
    const c = sse(port);
    const res = await c.ready;
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
    await until(() => c.messages().length >= 1);
    expect(c.messages()[0].type).toBe("snapshot");
    c.close();
  });

  it("broadcast reaches all clients; a disconnected client is removed without error", async () => {
    const { hub, port } = await start();
    const a = sse(port);
    const b = sse(port);
    await until(() => a.messages().length >= 1 && b.messages().length >= 1);
    expect(hub.size).toBe(2);
    hub.broadcast({ type: "status", status: "live" });
    await until(() => a.messages().length >= 2 && b.messages().length >= 2);
    expect(a.messages()[1]).toEqual({ type: "status", status: "live" });
    expect(b.messages()[1]).toEqual({ type: "status", status: "live" });

    b.close();
    await until(() => hub.size === 1);
    expect(() => hub.broadcast({ type: "status", status: "paused" })).not.toThrow();
    await until(() => a.messages().length >= 3);
    a.close();
  });

  it("snapshot never contains the token", async () => {
    expect(JSON.stringify(snap())).not.toContain(SENTINEL);
    const { port } = await start();
    const c = sse(port);
    await until(() => c.messages().length >= 1);
    expect(c.raw()).not.toContain(SENTINEL);
    expect(c.messages()[0]).toMatchObject({ type: "snapshot", leagueName: "L", theme: cfg.theme });
    c.close();
  });

  it("HEAD /events ends immediately without attaching a client", async () => {
    const { hub, port } = await start();
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/events", method: "HEAD" }, (r) => {
        r.resume();
        r.on("end", () => resolve(r));
      });
      req.on("error", reject);
      req.end();
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(hub.size).toBe(0);
  });

  it("sends ': ping' comments on the ping interval", async () => {
    const { port } = await start({ pingMs: 20 });
    const c = sse(port);
    await until(() => c.raw().includes(": ping\n\n"));
    c.close();
  });
});

describe("static and logo", () => {
  function site() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hubsite-"));
    const web = path.join(base, "web");
    fs.mkdirSync(path.join(web, "assets"), { recursive: true });
    fs.writeFileSync(path.join(web, "index.html"), "<html>INDEX</html>");
    fs.writeFileSync(path.join(web, "assets", "app.js"), "console.log(1)");
    fs.writeFileSync(path.join(base, "package.json"), '{"secret":true}');
    fs.writeFileSync(path.join(base, "logo.png"), "PNGDATA");
    return { base, web };
  }

  it("serves files with content types and SPA fallback", async () => {
    const { web } = site();
    const { port } = await start({ webRoot: web });
    const js = await get(port, "/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.type).toContain("javascript");
    const root = await get(port, "/");
    expect(root.body).toContain("INDEX");
    expect(root.type).toContain("text/html");
    const spa = await get(port, "/standings");
    expect(spa.status).toBe(200);
    expect(spa.body).toContain("INDEX");
    expect((await get(port, "/missing.js")).status).toBe(404);
  });

  it("refuses path traversal", async () => {
    const { web } = site();
    const { port } = await start({ webRoot: web });
    for (const p of ["/../package.json", "/%2e%2e/package.json", "/assets/../../package.json", "/%2e%2e%2fpackage.json", "/..%5cpackage.json", "/%00", "/index.html%00.png", "/..%00/package.json"]) {
      const r = await get(port, p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).not.toContain("secret");
    }
  });

  it("/logo serves the configured file, 404 when unset or missing", async () => {
    const { web, base } = site();
    let logo: string | undefined;
    const { port } = await start({ webRoot: web, logoPath: () => logo });
    expect((await get(port, "/logo")).status).toBe(404);
    logo = path.join(base, "nope.png");
    expect((await get(port, "/logo")).status).toBe(404);
    logo = path.join(base, "logo.png");
    const r = await get(port, "/logo");
    expect(r.status).toBe(200);
    expect(r.type).toBe("image/png");
    expect(r.body).toBe("PNGDATA");
  });
});
