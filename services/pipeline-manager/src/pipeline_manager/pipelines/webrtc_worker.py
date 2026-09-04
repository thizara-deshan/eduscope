"""Minimal one-negotiation GStreamer worker; keep its cold import path small."""
from __future__ import annotations

import argparse
import json
import signal
import sys
import threading


def main() -> None:  # pragma: no cover - exercised by the RK3588 integration gate
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", required=True)
    args = parser.parse_args()

    import gi
    gi.require_version("Gst", "1.0")
    gi.require_version("GstSdp", "1.0")
    gi.require_version("GstWebRTC", "1.0")
    from gi.repository import GLib, Gst, GstSdp, GstWebRTC

    Gst.init(None)
    pipeline = Gst.parse_launch(args.graph)
    peer = pipeline.get_by_name("sendrecv")
    loop = GLib.MainLoop()
    negotiation_id = [None]

    def emit(kind: str, **fields) -> None:
        print(json.dumps({"type": kind, "negotiation_id": negotiation_id[0], **fields}, separators=(",", ":")), flush=True)

    def on_ice(_peer, mline: int, candidate: str) -> None:
        # Thumbnail signaling is device-local.  Advertising only host
        # candidates avoids NAT traversal and its UPnP contention entirely.
        if negotiation_id[0] and " typ host " in f" {candidate} ":
            emit("ice", candidate=candidate, sdp_mline_index=mline)

    def answer_created(promise, _peer) -> None:
        reply = promise.get_reply()
        answer = reply.get_value("answer") if reply else None
        if answer is None:
            emit("error", code="answer-failed", message="create-answer returned no SDP")
            loop.quit()
            return
        peer.emit("set-local-description", answer, Gst.Promise.new())
        emit("answer", sdp=answer.sdp.as_text())

    def apply(message: dict) -> bool:
        kind = message.get("type")
        if kind == "offer":
            negotiation_id[0] = message["negotiation_id"]
            _ok, sdp = GstSdp.SDPMessage.new()
            if GstSdp.sdp_message_parse_buffer(message["sdp"].encode(), sdp) != GstSdp.SDPResult.OK:
                emit("error", code="invalid-sdp", message="offer SDP could not be parsed")
                loop.quit()
                return False
            desc = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.OFFER, sdp)
            promise = Gst.Promise.new()
            peer.emit("set-remote-description", desc, promise)
            promise.wait()
            peer.emit("create-answer", None, Gst.Promise.new_with_change_func(answer_created, peer))
        elif kind == "ice" and " typ host " in f" {message.get('candidate', '')} ":
            peer.emit("add-ice-candidate", message.get("sdp_mline_index") or 0, message["candidate"])
        elif kind == "close":
            print("Got EOS", flush=True)
            loop.quit()
        return False

    def read_stdin() -> None:
        for line in sys.stdin:
            try:
                message = json.loads(line)
                if isinstance(message, dict):
                    GLib.idle_add(apply, message)
            except (json.JSONDecodeError, KeyError) as exc:
                print(f"invalid control line ignored: {exc}", file=sys.stderr, flush=True)

    peer.connect("on-ice-candidate", on_ice)
    threading.Thread(target=read_stdin, daemon=True).start()
    bus = pipeline.get_bus()
    bus.add_signal_watch()

    def bus_message(_bus, message) -> None:
        if message.type == Gst.MessageType.ERROR:
            error, _debug = message.parse_error()
            if negotiation_id[0]:
                emit("error", code="pipeline-error", message=str(error))
            loop.quit()
        elif message.type == Gst.MessageType.STATE_CHANGED and message.src == pipeline:
            _old, new, _pending = message.parse_state_changed()
            if new == Gst.State.PLAYING:
                print("PLAYING", flush=True)

    handler = bus.connect("message", bus_message)
    def stop() -> bool:
        print("Got EOS", flush=True)
        loop.quit()
        return False

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, stop)
    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        bus.disconnect(handler)
        bus.remove_signal_watch()
        pipeline.set_state(Gst.State.NULL)
        pipeline.get_state(2 * Gst.SECOND)


if __name__ == "__main__":
    main()
