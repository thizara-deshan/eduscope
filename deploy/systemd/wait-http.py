#!/usr/bin/python3
import sys
import time
import urllib.request

if len(sys.argv) != 3:
    raise SystemExit("usage: wait-http.py URL SECONDS")
url, seconds = sys.argv[1], float(sys.argv[2])
if not url.startswith(("http://127.0.0.1:", "http://[::1]:")):
    raise SystemExit("loopback URL required")
deadline = time.monotonic() + seconds
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            if 200 <= response.status < 300:
                print(f"PASS health {url}")
                raise SystemExit(0)
    except Exception:
        pass
    time.sleep(0.5)
raise SystemExit(f"health timeout: {url}")
