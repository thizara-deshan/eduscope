"""Board worker that keeps a record mux alive across camera shm loss."""

from __future__ import annotations

import argparse
import json
import signal
from pathlib import Path


def run(graph: str, roles: list[str]) -> None:  # pragma: no cover - exercised by board integration tests
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import GLib, Gst

    Gst.init(None)
    pipeline = Gst.parse_launch(graph)
    loop = GLib.MainLoop()
    recovering: set[str] = set()
    reconnect_in_flight: set[str] = set()
    eos_guards: list[tuple[object, int]] = []

    # A disconnected shmsrc posts both ERROR and EOS.  EOS belongs only to
    # that recoverable input branch; allowing it to reach the mux would end
    # the whole recording after the selector has already moved to fallback.
    for role in roles:
        source = pipeline.get_by_name(f"source_{role.replace('-', '_')}")
        if source is not None:
            pad = source.get_static_pad("src")
            probe_id = pad.add_probe(
                Gst.PadProbeType.EVENT_DOWNSTREAM,
                lambda _pad, info: (
                    Gst.PadProbeReturn.DROP
                    if info.get_event().type == Gst.EventType.EOS
                    else Gst.PadProbeReturn.OK
                ),
            )
            eos_guards.append((pad, probe_id))

    def select(role: str, index: int) -> None:
        selector = pipeline.get_by_name(f"sel_{role.replace('-', '_')}")
        if selector is not None:
            selector.set_property("active-pad", selector.get_static_pad(f"sink_{index}"))

    def retry(role: str) -> bool:
        if role not in recovering:
            return False
        if role in reconnect_in_flight:
            return True
        source = pipeline.get_by_name(f"source_{role.replace('-', '_')}")
        socket = {"lecturer-cam": "/tmp/rtsp.sock", "students-cam": "/tmp/rtsp2.sock"}[role]
        if source is None or not Path(socket).is_socket():
            return True
        source.set_state(Gst.State.NULL)
        result = source.set_state(Gst.State.PLAYING)
        if result == Gst.StateChangeReturn.FAILURE:
            return True
        reconnect_in_flight.add(role)

        pad = source.get_static_pad("src")

        def first_buffer(_pad, info):
            if info.type & Gst.PadProbeType.BUFFER:
                def restore() -> bool:
                    select(role, 0)
                    recovering.discard(role)
                    reconnect_in_flight.discard(role)
                    print(f"SOURCE RESTORED: {role}", flush=True)
                    return False

                GLib.idle_add(restore)
                return Gst.PadProbeReturn.REMOVE
            return Gst.PadProbeReturn.OK

        pad.add_probe(Gst.PadProbeType.BUFFER, first_buffer)
        return False

    def on_message(_bus, message) -> bool:
        if message.type == Gst.MessageType.STATE_CHANGED and message.src == pipeline:
            _old, new, _pending = message.parse_state_changed()
            if new == Gst.State.PLAYING:
                print("PLAYING", flush=True)
        elif message.type == Gst.MessageType.EOS:
            print("Got EOS", flush=True)
            loop.quit()
        elif message.type == Gst.MessageType.ERROR:
            source_name = message.src.get_name()
            role = next((r for r in roles if source_name == f"source_{r.replace('-', '_')}"), None)
            if role is None:
                err, debug = message.parse_error()
                print(f"ERROR: {err} {debug or ''}", flush=True)
                loop.quit()
            elif role not in recovering:
                recovering.add(role)
                select(role, 1)
                message.src.set_state(Gst.State.NULL)
                print(f"SOURCE UNAVAILABLE: {role}", flush=True)
                GLib.timeout_add(500, retry, role)
            else:
                # The pathname may exist before the replacement publisher is
                # ready to serve buffers.  Clear the in-flight attempt so the
                # existing timer tries the same source again.
                reconnect_in_flight.discard(role)
                message.src.set_state(Gst.State.NULL)
        return True

    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", on_message)

    def stop() -> bool:
        for pad, probe_id in eos_guards:
            pad.remove_probe(probe_id)
        eos_guards.clear()
        pipeline.send_event(Gst.Event.new_eos())
        return False

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, stop)
    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", required=True)
    parser.add_argument("--roles", required=True)
    args = parser.parse_args()
    run(args.graph, json.loads(args.roles))


if __name__ == "__main__":
    main()
