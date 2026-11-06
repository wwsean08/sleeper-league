import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Lines are "<secs> <json frame>"; frames are [join_ref, ref, topic, event, payload]. No delays. */
export function replayFrames(logText: string, onEvent: (event: string, payload: any) => void): void {
  for (const line of logText.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(line.slice(sp + 1));
    } catch {
      continue;
    }
    if (!Array.isArray(frame)) continue;
    const event = frame[3];
    if (typeof event !== "string" || event === "phx_reply") continue;
    onEvent(event, frame[4]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run replay -- <log file>");
    process.exit(1);
  }
  const counts = new Map<string, number>();
  replayFrames(readFileSync(path, "utf8"), (e) => counts.set(e, (counts.get(e) ?? 0) + 1));
  for (const [e, n] of counts) console.log(`${e} ${n}`);
}
