#!/usr/bin/env python3
"""
Eduscope audio producer  —  replaces pub_audio.sh

Opens BOTH USB audio cards, gives each its own software fader and level
meter, mixes them, and publishes the mix to the SAME shm socket every
record / preview / live pipeline already reads:

        card 7  BOMGE ──► volume(vol_bomge) ──► level(lvl_bomge) ─┐
                                                                  ├─ audiomixer ─► shmsink /tmp/audio.sock
        card 8  UMS   ──► volume(vol_ums)   ──► level(lvl_ums)   ─┘

Because the two `level` elements sit AFTER their `volume`, the meters are
post-fader (drag a slider down and its meter drops) — same feel as the
Ubuntu input panel. Move `level` before `volume` in build_pipeline() if
you want a pre-fader "is the mic alive" meter instead.

A tiny HTTP server (127.0.0.1:8090) lets the web panel read the meters and
move the faders:

        GET  /levels            -> {"running":true,
                                     "bomge":{"rms":-32.1,"peak":-18.4,"vol":1.0},
                                     "ums":  {"rms":-40.0,"peak":-27.3,"vol":1.0}}
        POST /volume  {"ch":"bomge","value":0.7}

Faders persist to ~/.eduscope_audio.json across restarts.

Run:  python3 pub_audio.py        (needs python3-gi + gstreamer1.0 plugins)
Debug: AUDIO_DEBUG=1 prints the first raw level structure to stderr, so you
       can see exactly how your GStreamer build serialises rms/peak.
Env:  AUDIO_SOCK   (default /tmp/audio.sock)
      AUDIO_CTRL_PORT (default 8090)
      BOMGE_MATCH  (default "BOMGE")     substring in /proc/asound/cards
      UMS_MATCH    (default "Eduscope")  substring in /proc/asound/cards
      BOMGE_DEV / UMS_DEV  override the ALSA device string, e.g. "hw:7,0"
"""

import json
import math
import os
import re
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import gi
gi.require_version("Gst", "1.0")
from gi.repository import Gst, GLib  # noqa: E402

# ───────────────────────── config ─────────────────────────
SOCK = os.environ.get("AUDIO_SOCK", "/tmp/audio.sock")
CTRL_PORT = int(os.environ.get("AUDIO_CTRL_PORT", "8090"))
BOMGE_MATCH = os.environ.get("BOMGE_MATCH", "BOMGE")
UMS_MATCH = os.environ.get("UMS_MATCH", "Eduscope")
DEBUG = os.environ.get("AUDIO_DEBUG", "") not in ("", "0")
STATE_FILE = os.path.join(os.path.expanduser("~"), ".eduscope_audio.json")

RATE = 48000
CHANNELS = 2
FLOOR = -100.0            # dB reported for silence (never -inf, which breaks JSON)

# ───────────────────────── shared state ─────────────────────────
LOCK = threading.Lock()
LEVELS = {
    "lvl_bomge": {"rms": FLOOR, "peak": FLOOR},
    "lvl_ums":   {"rms": FLOOR, "peak": FLOOR},
}
VOL = {"bomge": 1.0, "ums": 1.0}
_dbg_printed = False


def load_vol():
    try:
        with open(STATE_FILE) as f:
            d = json.load(f)
        for k in ("bomge", "ums"):
            if k in d:
                VOL[k] = max(0.0, min(2.0, float(d[k])))
    except Exception:
        pass


def save_vol():
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(VOL, f)
    except Exception:
        pass


# ───────────────────────── ALSA card lookup ─────────────────────────
def find_card(substr):
    """Return the ALSA card NUMBER whose /proc/asound/cards line contains
    `substr` (case-insensitive). Robust against USB re-enumeration order."""
    try:
        txt = open("/proc/asound/cards").read()
    except OSError:
        return None
    for line in txt.splitlines():
        m = re.match(r"\s*(\d+)\s*\[", line)
        if m and substr.lower() in line.lower():
            return int(m.group(1))
    return None


def resolve(dev_env, match, label):
    dev = os.environ.get(dev_env)
    if dev:
        return dev
    n = find_card(match)
    if n is None:
        sys.stderr.write(
            f"[pub_audio] ERROR: could not find {label} card "
            f"(no '{match}' in /proc/asound/cards). "
            f"Set {dev_env}=hw:X,0 to override.\n")
        sys.exit(1)
    return f"hw:{n},0"


# ───────────────────────── level message parsing ─────────────────────────
def _san(x):
    """Clamp to a finite dB range so the JSON never contains inf/-inf/nan."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return FLOOR
    if not math.isfinite(x):
        return FLOOR
    return max(FLOOR, min(12.0, x))


def _api_floats(s, field):
    """Try the PyGObject API first — returns a list on modern builds."""
    try:
        v = s.get_value(field)
    except Exception:
        return []
    if v is None:
        return []
    try:
        return [float(x) for x in v]
    except TypeError:
        return []


_NUM = r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|-?inf"


def _regex_floats(txt, field):
    """Fallback: parse the serialised structure. Handles BOTH array forms
    the level element can emit:
        field=(double){ -18.5, -19.2 }          (GstValueList)
        field=< (double)-18.5, (double)-19.2 >  (GstValueArray)
    with an optional type prefix before either bracket."""
    m = re.search(field + r"=(?:\([^)]*\))?\s*[\{<]([^}>]*)[\}>]", txt)
    if m:
        return [float(x) for x in re.findall(_NUM, m.group(1))]
    m2 = re.search(field + r"=(?:\([^)]*\))?\s*(" + _NUM + r")", txt)
    return [float(m2.group(1))] if m2 else []


def _levels_from_struct(s):
    rms = _api_floats(s, "rms")
    peak = _api_floats(s, "peak")
    if rms and peak:
        return rms, peak
    txt = s.to_string()
    return _regex_floats(txt, "rms"), _regex_floats(txt, "peak")


def on_bus(bus, msg, _data):
    global _dbg_printed
    if msg.type == Gst.MessageType.ELEMENT:
        s = msg.get_structure()
        if s and s.get_name() == "level":
            if DEBUG and not _dbg_printed:
                _dbg_printed = True
                sys.stderr.write("[pub_audio] first level struct:\n  "
                                 + s.to_string() + "\n")
            name = msg.src.get_name()          # 'lvl_bomge' or 'lvl_ums'
            if name in LEVELS:
                rms, peak = _levels_from_struct(s)
                if rms and peak:
                    with LOCK:
                        LEVELS[name]["rms"] = _san(max(rms))
                        LEVELS[name]["peak"] = _san(max(peak))
    elif msg.type == Gst.MessageType.ERROR:
        err, dbg = msg.parse_error()
        sys.stderr.write(f"[pub_audio] GST ERROR: {err.message}\n{dbg}\n")
        MAIN_LOOP.quit()
    return True


# ───────────────────────── pipeline ─────────────────────────
def build_pipeline(bomge_dev, ums_dev):
    caps = (f"audio/x-raw,format=S16LE,rate={RATE},"
            f"channels={CHANNELS},layout=interleaved")
    # Two USB cards have independent clocks. Left alone, audiomixer picks one
    # as master and DROPS the other once its buffers drift "late" (the missing
    # card after ~30-60s). Fix WITHOUT rewriting samples (audiorate silences
    # the stream): provide-clock=false takes both cards off clock-master duty
    # so the neutral system clock drives the pipeline and every buffer is
    # arrival-stamped (never progressively behind), and audiomixer latency=200ms
    # makes the mixer WAIT for a slightly-late buffer instead of dropping it.
    desc = f"""
        alsasrc device={bomge_dev} do-timestamp=true provide-clock=false !
            audioconvert ! audioresample ! {caps} !
            volume name=vol_bomge volume={VOL['bomge']} !
            level name=lvl_bomge interval=100000000 post-messages=true !
            queue max-size-time=200000000 ! mix.

        alsasrc device={ums_dev} do-timestamp=true provide-clock=false !
            audioconvert ! audioresample ! {caps} !
            volume name=vol_ums volume={VOL['ums']} !
            level name=lvl_ums interval=100000000 post-messages=true !
            queue max-size-time=200000000 ! mix.

        audiomixer name=mix latency=200000000 !
            audioconvert ! audioresample ! {caps} !
            queue max-size-time=200000000 !
            shmsink socket-path={SOCK} shm-size=4000000
                    wait-for-connection=false sync=false
    """
    return Gst.parse_launch(desc)


# ───────────────────────── HTTP control / telemetry ─────────────────────────
class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/levels":
            with LOCK:
                self._send(200, {
                    "running": True,
                    "bomge": {**LEVELS["lvl_bomge"], "vol": VOL["bomge"]},
                    "ums":   {**LEVELS["lvl_ums"],   "vol": VOL["ums"]},
                })
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/volume":
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
                ch = data.get("ch")
                val = max(0.0, min(2.0, float(data.get("value", 1.0))))
            except Exception as e:
                return self._send(400, {"error": f"bad body: {e}"})
            elem = {"bomge": VOL_ELEMS["bomge"], "ums": VOL_ELEMS["ums"]}.get(ch)
            if elem is None:
                return self._send(400, {"error": "ch must be bomge or ums"})
            elem.set_property("volume", val)
            with LOCK:
                VOL[ch] = val
            save_vol()
            self._send(200, {"ok": True, "ch": ch, "value": val})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *a):   # keep the console quiet
        pass


def serve_http():
    srv = ThreadingHTTPServer(("127.0.0.1", CTRL_PORT), Handler)
    srv.serve_forever()


# ───────────────────────── main ─────────────────────────
VOL_ELEMS = {}
MAIN_LOOP = None


def main():
    global MAIN_LOOP
    Gst.init(None)
    load_vol()

    bomge_dev = resolve("BOMGE_DEV", BOMGE_MATCH, "BOMGE")
    ums_dev = resolve("UMS_DEV", UMS_MATCH, "UMS")
    sys.stderr.write(f"[pub_audio] BOMGE={bomge_dev}  UMS={ums_dev}  -> {SOCK}\n")

    try:
        os.unlink(SOCK)
    except OSError:
        pass

    pipeline = build_pipeline(bomge_dev, ums_dev)
    VOL_ELEMS["bomge"] = pipeline.get_by_name("vol_bomge")
    VOL_ELEMS["ums"] = pipeline.get_by_name("vol_ums")

    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", on_bus, None)

    MAIN_LOOP = GLib.MainLoop()

    def quit_clean(*_a):
        pipeline.set_state(Gst.State.NULL)
        try:
            os.unlink(SOCK)
        except OSError:
            pass
        MAIN_LOOP.quit()
        return GLib.SOURCE_REMOVE

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, quit_clean)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, quit_clean)

    threading.Thread(target=serve_http, daemon=True).start()
    pipeline.set_state(Gst.State.PLAYING)
    try:
        MAIN_LOOP.run()
    finally:
        pipeline.set_state(Gst.State.NULL)


if __name__ == "__main__":
    main()
