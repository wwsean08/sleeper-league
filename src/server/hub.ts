import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "./config.js";
import type { LeagueView } from "./league.js";
import type { PlayEntry } from "./plays.js";
import type { FeedStatus } from "./sleeper/socket.js";

export type UiConfig = Pick<Config, "rotationSeconds" | "takeoverSeconds" | "playlist" | "playlistSeconds" | "pollSeconds" | "spotlightMinPlayPoints">;

export type ServerMessage =
  | {
      type: "snapshot";
      /** Absent until the first successful REST load, so pages can show "Waiting for league data…". */
      league?: LeagueView;
      /** Epoch ms of the last successful REST poll; absent before the first one. */
      lastPollOkAt?: number;
      feed: PlayEntry[];
      takeover: PlayEntry | null;
      status: FeedStatus;
      theme: Config["theme"];
      ui: UiConfig;
      leagueName: string;
    }
  | { type: "league"; league: LeagueView; lastPollOkAt?: number }
  | { type: "feed"; play: PlayEntry }
  | { type: "takeover"; play: PlayEntry }
  | { type: "status"; status: FeedStatus };

export const FEED_LIMIT = 200;
const PING_MS = 15_000;

/** Builds a snapshot from an explicit allow-list of config fields, so secrets (token) can never leak. */
export function buildSnapshot(s: {
  league: LeagueView | undefined;
  lastPollOkAt?: number | undefined;
  feed: PlayEntry[];
  takeover: PlayEntry | null;
  status: FeedStatus;
  cfg: Config;
  leagueName: string;
}): ServerMessage {
  const { cfg } = s;
  const theme: Config["theme"] = { colors: { ...cfg.theme.colors }, fontFamily: cfg.theme.fontFamily };
  // The logo is always served via /logo, never as a filesystem path.
  if (cfg.theme.logo) theme.logo = "/logo";
  const msg: Extract<ServerMessage, { type: "snapshot" }> = {
    type: "snapshot",
    feed: s.feed.slice(-FEED_LIMIT),
    takeover: s.takeover,
    status: s.status,
    theme,
    ui: {
      rotationSeconds: cfg.rotationSeconds,
      takeoverSeconds: cfg.takeoverSeconds,
      playlist: [...cfg.playlist],
      playlistSeconds: cfg.playlistSeconds,
      pollSeconds: cfg.pollSeconds,
      spotlightMinPlayPoints: cfg.spotlightMinPlayPoints,
    },
    leagueName: s.leagueName,
  };
  if (s.league) msg.league = s.league;
  if (s.lastPollOkAt !== undefined) msg.lastPollOkAt = s.lastPollOkAt;
  return msg;
}

export class Hub {
  private readonly clients = new Set<ServerResponse>();
  private snapshot: (() => ServerMessage) | undefined;
  private readonly pingTimer: NodeJS.Timeout;

  constructor(opts: { pingMs?: number | undefined } = {}) {
    this.pingTimer = setInterval(() => {
      for (const res of this.clients) this.write(res, ": ping\n\n");
    }, opts.pingMs ?? PING_MS);
    this.pingTimer.unref();
  }

  get size(): number {
    return this.clients.size;
  }

  setSnapshot(fn: () => ServerMessage): void {
    this.snapshot = fn;
  }

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    res.on("close", drop);
    res.on("error", drop);
    if (this.snapshot) {
      try {
        this.write(res, frame(this.snapshot()));
      } catch (e) {
        console.error(`[hub] snapshot failed: ${(e as Error).message}`);
      }
    }
  }

  broadcast(m: ServerMessage): void {
    const data = frame(m);
    for (const res of this.clients) this.write(res, data);
  }

  close(): void {
    clearInterval(this.pingTimer);
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  private write(res: ServerResponse, data: string): void {
    if (res.destroyed || res.writableEnded) {
      this.clients.delete(res);
      return;
    }
    try {
      res.write(data);
    } catch {
      this.clients.delete(res);
    }
  }
}

function frame(m: ServerMessage): string {
  return `data: ${JSON.stringify(m)}\n\n`;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function notFound(res: ServerResponse): void {
  if (res.headersSent) return void res.end();
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

/** Streams a regular file; 404 if it is missing, not a file, or unreadable. */
function sendFile(res: ServerResponse, file: string, head: boolean): void {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const stream = fs.createReadStream(file);
    stream.on("error", () => {
      if (!res.headersSent) notFound(res);
      else res.destroy();
    });
    stream.on("open", () => {
      res.writeHead(200, { "Content-Type": contentType(file), "Content-Length": st.size });
      if (head) {
        stream.destroy();
        res.end();
      } else {
        // pipeline destroys the read stream if the client aborts; errors are expected then and ignored.
        pipeline(stream, res, () => {});
      }
    });
  });
}

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function serveStatic(root: string, rawPath: string, res: ServerResponse, head: boolean): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return notFound(res);
  }
  // Reject NUL, backslashes and any ".." segment outright rather than relying only on normalisation.
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").includes("..")) return notFound(res);
  const resolved = path.resolve(root, "." + decoded);
  if (!isInside(root, resolved)) return notFound(res);
  const index = path.join(root, "index.html");
  fs.stat(resolved, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, resolved, head);
    if (!err && st.isDirectory()) {
      const inner = path.join(resolved, "index.html");
      return fs.stat(inner, (e2, s2) => sendFile(res, !e2 && s2.isFile() ? inner : index, head));
    }
    // SPA fallback for route-like paths; asset-like paths (with an extension) are a real 404.
    if (path.extname(resolved)) return notFound(res);
    sendFile(res, index, head);
  });
}

export function createHttpServer(opts: {
  hub: Hub;
  webRoot: string;
  /** Absolute path of the logo file, or an http(s) URL, or undefined when none is configured. */
  logoPath: () => string | undefined;
}): http.Server {
  const root = path.resolve(opts.webRoot);
  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        return void res.end();
      }
      const head = method === "HEAD";
      const rawUrl = req.url ?? "/";
      const q = rawUrl.indexOf("?");
      const rawPath = q < 0 ? rawUrl : rawUrl.slice(0, q);
      if (rawPath === "/events") {
        if (head) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          return void res.end();
        }
        return opts.hub.attach(res);
      }
      if (rawPath === "/logo") {
        const logo = opts.logoPath();
        if (!logo) return notFound(res);
        if (/^https?:\/\//i.test(logo)) {
          res.writeHead(302, { Location: logo });
          return void res.end();
        }
        return sendFile(res, logo, head);
      }
      serveStatic(root, rawPath, res, head);
    } catch (e) {
      console.error(`[http] ${(e as Error).message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
  });
}
