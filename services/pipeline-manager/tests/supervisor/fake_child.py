"""A fake gst-launch-1.0 child for supervisor tests. Never touches real GStreamer.

Modes (argv[1]):
  playing        - prints PLAYING once, then waits for SIGINT -> "Got EOS".
  grow:<path>    - prints PLAYING, then grows <path> over ~1.5s, then waits for SIGINT.
  error          - prints an ERROR line, then waits for SIGINT.
  qos            - prints PLAYING then a few QOS lines, then waits for SIGINT.
  hang           - never prints PLAYING; waits for SIGINT.
  ignore-sigint  - never honors SIGINT (for SIGKILL-escalation tests, A-08).
  eos-then-hang  - honors SIGINT with "Got EOS" but then never actually exits
                   (a hung downstream muxer/sink) — for the single monotonic
                   EOS+exit deadline test, A-REV-006.
"""

from __future__ import annotations

import signal
import sys
import time


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "playing"
    eos_requested = False

    def _on_sigint(signum: int, frame: object) -> None:
        nonlocal eos_requested
        eos_requested = True

    if mode == "ignore-sigint":
        try:
            signal.signal(signal.SIGINT, signal.SIG_IGN)
        except (ValueError, OSError):
            pass
        while True:
            time.sleep(0.05)

    try:
        signal.signal(signal.SIGINT, _on_sigint)
    except (ValueError, OSError):
        pass

    if mode == "hang":
        while not eos_requested:
            time.sleep(0.05)
        print("Got EOS", flush=True)
        return

    if mode == "error":
        print("ERROR: fake element error", flush=True)
        while not eos_requested:
            time.sleep(0.05)
        print("Got EOS", flush=True)
        return

    if mode.startswith("grow:"):
        path = mode.split(":", 1)[1]
        print("PLAYING", flush=True)
        with open(path, "wb") as handle:
            for _ in range(5):
                if eos_requested:
                    break
                handle.write(b"x" * 1024)
                handle.flush()
                time.sleep(0.3)
        while not eos_requested:
            time.sleep(0.05)
        print("Got EOS", flush=True)
        return

    if mode == "eos-then-hang":
        print("PLAYING", flush=True)
        while not eos_requested:
            time.sleep(0.05)
        print("Got EOS", flush=True)
        while True:
            time.sleep(0.05)
        return

    if mode == "qos":
        print("PLAYING", flush=True)
        for _ in range(3):
            print("QOS: dropped=1", flush=True)
            time.sleep(0.05)
        while not eos_requested:
            time.sleep(0.05)
        print("Got EOS", flush=True)
        return

    # default: "playing"
    print("PLAYING", flush=True)
    while not eos_requested:
        time.sleep(0.05)
    print("Got EOS", flush=True)


if __name__ == "__main__":
    main()
