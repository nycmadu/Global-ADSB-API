const fs = require("fs");
const path = require("path");
const https = require("https");
const express = require("express");
const app = express();

/** ================== CONFIG ================== **/
const PORT = process.env.PORT || 3200;
const AIRPLANES_BASE = "https://api.airplanes.live";
const RADIUS = 250;                               // nm per query (max)

const TICK_MS = 1000;                             // emit/update once per second

// HTTP agent tuning for massive parallel fan-out
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: Infinity,       // let Node open as many as needed
  maxFreeSockets: 4096,
  timeout: 15000,
  keepAliveMsecs: 5000
});

/** ============== LOAD POINTS LIST ============== **/
const POINTS_PATH = path.join(__dirname, "points.json");
let POINTS = [];
try {
  POINTS = JSON.parse(fs.readFileSync(POINTS_PATH, "utf8"));
} catch (e) {
  console.error("[FATAL] points.json missing or invalid:", e.message);
  process.exit(1);
}
if (!Array.isArray(POINTS) || POINTS.length === 0) {
  console.error("[FATAL] points.json is empty.");
  process.exit(1);
}

/** ============== HELPERS ============== **/
function fetchPoint(lat, lon, radiusNm) {
  return new Promise((resolve, reject) => {
    const url = `${AIRPLANES_BASE}/v2/point/${lat}/${lon}/${radiusNm}`;
    const req = https.get(
      url,
      {
        agent,
        headers: {
          "accept": "application/json",
          "user-agent": "global-adsb-allpoints/1.0"
        },
        timeout: 12000
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              // If a single point returns malformed JSON, treat as empty
              resolve({ ac: [] });
            }
          } else {
            // Treat upstream errors as empty for this tick to avoid breaking stream
            resolve({ ac: [] });
          }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ ac: [] }); });
    req.on("error", () => resolve({ ac: [] }));
  });
}

// merge & dedupe by hex (prefer freshest seen/seen_pos)
function mergeAircraft(lists) {
  const byHex = new Map();
  for (const list of lists) {
    const ac = list && (list.ac || list.aircraft || []);
    for (const a of ac) {
      const key = a.hex || a.icao || a.icao_24 || a.hexid;
      if (!key) continue;
      const prev = byHex.get(key);
      if (!prev) {
        byHex.set(key, a);
      } else {
        const ap = (prev.seen_pos ?? prev.seen ?? 9999);
        const an = (a.seen_pos ?? a.seen ?? 9999);
        if (an < ap) byHex.set(key, a);
      }
    }
  }
  return Array.from(byHex.values());
}

/** ============== ROUTES ============== **/
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    points: POINTS.length,
    cfg: { PORT, RADIUS, TICK_MS, base: AIRPLANES_BASE }
  });
});

// ONE global SSE stream that hits EVERY point once per second
// and emits exactly: data: {"ac":[ ... ]}\n\n
app.get("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  console.log("[INFO] Client connected to /stream");
  let alive = true;
  req.on("close", () => { alive = false; console.log("[INFO] Client disconnected from /stream"); });

  const tick = async () => {
    if (!alive) return;

    // Fire all requests for this second in parallel
    const tasks = POINTS.map(p =>
      fetchPoint(p.lat, p.lon, RADIUS).catch(() => ({ ac: [] }))
    );

    try {
      const results = await Promise.all(tasks);
      const merged = mergeAircraft(results);
      res.write(`data: ${JSON.stringify({ ac: merged })}\n\n`);
    } catch {
      // Still keep the stream going
      res.write(`data: {"ac":[]}\n\n`);
    }

    setTimeout(tick, TICK_MS);
  };

  tick();
});

/** ============== START ============== **/
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[INFO] Global ALL-POINTS stream on :${PORT} | points=${POINTS.length} | radius=${RADIUS}nm | 1 tick/sec (EVERY point each tick)`
  );
});
