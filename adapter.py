#!/usr/bin/env python3
import os, time, json, tempfile, requests
from collections import deque

STREAM_URL   = os.environ.get("STREAM_URL", "https://adsb.chrisnyc.net/KJFK")
OUT_PATH     = os.environ.get("OUT_PATH", "/opt/globe/html/data/aircraft.json")
WRITE_EVERY_S= float(os.environ.get("WRITE_EVERY_S", "1.0"))
BUFFER_SEC   = int(os.environ.get("BUFFER_SEC", "15"))  # keep ~15 seconds of data

# store last and batches
buffer = deque()

def atomic_write(path, obj):
    tmpf = tempfile.NamedTemporaryFile("w", dir=os.path.dirname(path), delete=False)
    json.dump(obj, tmpf, separators=(",", ":"))
    tmp = tmpf.name
    tmpf.close()
    os.replace(tmp, path)

def main():
    last_write = 0
    headers = {"User-Agent": "tar1090-adapter/1.0"}
    while True:
        try:
            with requests.get(STREAM_URL, headers=headers, stream=True, timeout=30) as r:
                r.raise_for_status()
                for raw in r.iter_lines(decode_unicode=True):
                    if raw and raw.startswith("data:"):
                        try:
                            obj = json.loads(raw[5:].strip())
                            if "ac" in obj:
                                now = int(time.time())
                                buffer.append((now, obj["ac"]))
                                # trim old entries
                                cutoff = now - BUFFER_SEC
                                while buffer and buffer[0][0] < cutoff:
                                    buffer.popleft()
                        except Exception:
                            pass
                    now = time.time()
                    if now - last_write >= WRITE_EVERY_S:
                        cutoff = int(time.time()) - BUFFER_SEC
                        merged = []
                        for ts, acs in list(buffer):
                            if ts >= cutoff:
                                merged.extend(acs)
                        atomic_write(OUT_PATH, {"now": int(time.time()), "aircraft": merged})
                        last_write = now
        except Exception:
            atomic_write(OUT_PATH, {"now": int(time.time()), "aircraft": []})
            time.sleep(1)

if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    main()
