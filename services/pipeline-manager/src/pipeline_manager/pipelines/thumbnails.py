from __future__ import annotations

import argparse
import json
import os
import sys
import shutil
import time
import uuid
from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..models import BINDABLE_SOURCE_ROLES, SourceRole
from .builder import CAMERA_ROLES, ROLE_SOCKETS
from .platforms.base import PlatformProfile
from .profiles import ProfileKind, get_profile

# Frame budget (bench default, B-T7) — the encode profile lives in profiles.py;
# these are the worker's fixed capture limits, not knobs.
THUMBNAIL_WIDTH = 480
THUMBNAIL_HEIGHT = 270
THUMBNAIL_FPS = 15

# The provisional third ledger slot only (A-07); never a guaranteed record/live slot.
ENCODE_RESERVATION_KIND = "thumbnail"

THUMBNAIL_ALLOWED_ROLES = BINDABLE_SOURCE_ROLES  # excludes mic-room (INV-SR-2)


class ControlMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ThumbnailOffer(ControlMessage):
    type: Literal["offer"]
    negotiation_id: str = Field(min_length=1)
    role_id: SourceRole
    sdp: str = Field(min_length=1, max_length=131_072)

    @field_validator("role_id")
    @classmethod
    def role_must_be_previewable(cls, value: SourceRole) -> SourceRole:
        if value not in THUMBNAIL_ALLOWED_ROLES:
            raise ValueError(f"{value.value} is not previewable")
        return value


class ThumbnailIce(ControlMessage):
    type: Literal["ice"]
    negotiation_id: str = Field(min_length=1)
    candidate: str = Field(max_length=8_192)
    sdp_mid: str | None = Field(default=None, max_length=128)
    sdp_mline_index: int | None = Field(default=None, ge=0, le=64)


class ThumbnailClose(ControlMessage):
    type: Literal["close"]
    negotiation_id: str = Field(min_length=1)


class ThumbnailAnswer(ControlMessage):
    type: Literal["answer"]
    negotiation_id: str
    sdp: str = Field(min_length=1, max_length=131_072)


class ThumbnailIceOut(ControlMessage):
    type: Literal["ice"]
    negotiation_id: str
    candidate: str
    sdp_mid: str | None = None
    sdp_mline_index: int | None = None


class ThumbnailWorkerError(ControlMessage):
    type: Literal["error"]
    negotiation_id: str
    code: str
    message: str


class ThumbnailPlaying(ControlMessage):
    type: Literal["playing"]
    negotiation_id: str


InboundMessage = Union[ThumbnailOffer, ThumbnailIce, ThumbnailClose]
OutboundMessage = Union[ThumbnailAnswer, ThumbnailIceOut, ThumbnailWorkerError, ThumbnailPlaying]

_INBOUND_TYPES: dict[str, type[InboundMessage]] = {
    "offer": ThumbnailOffer,
    "ice": ThumbnailIce,
    "close": ThumbnailClose,
}

_OUTBOUND_TYPES: dict[str, type[OutboundMessage]] = {
    "answer": ThumbnailAnswer,
    "ice": ThumbnailIceOut,
    "error": ThumbnailWorkerError,
    "playing": ThumbnailPlaying,
}


class InvalidControlMessage(ValueError):
    pass


def parse_control_line(line: str) -> InboundMessage:
    """Every control line validates before it can reach the worker's GI graph."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise InvalidControlMessage(f"invalid JSON: {exc}") from exc

    if not isinstance(raw, dict):
        raise InvalidControlMessage("control message must be a JSON object")

    model = _INBOUND_TYPES.get(raw.get("type"))
    if model is None:
        raise InvalidControlMessage(f"unknown control message type: {raw.get('type')!r}")

    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        raise InvalidControlMessage(str(exc)) from exc


def parse_worker_output_line(line: str) -> OutboundMessage | None:
    """The parent's counterpart of `parse_control_line`, for the worker's
    stdout: a line that isn't shaped like one of the outbound message types
    (e.g. a `gst-launch`-style bus status line, or plain diagnostic text)
    is not a signaling frame — the caller should just ignore it, not treat
    every stray line as a protocol violation.
    """
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(raw, dict):
        return None
    model = _OUTBOUND_TYPES.get(raw.get("type"))
    if model is None:
        return None
    try:
        return model.model_validate(raw)
    except ValidationError:
        return None


def encode_outbound_message(message: OutboundMessage) -> str:
    """One JSON object per line — the worker's stdout counterpart of
    `parse_control_line`'s stdin protocol (no length-delimiting needed: SDP
    text itself never contains a bare newline once JSON-escaped)."""
    return message.model_dump_json(by_alias=False)


def worker_argv(python_executable: str = sys.executable, *, graph: str | None = None) -> tuple[str, ...]:
    """One worker subprocess per negotiation — the parent supervises it (A-07);
    it never hosts an in-process media pipeline (rule 1). `graph` (from
    `worker_graph`, computed once `role_id` is known at offer time) is
    passed as a single argv element — never interpolated into a shell
    string (shell=False everywhere), and SDP/ICE themselves still arrive
    over stdin control lines, never argv, because they're per-negotiation
    and can keep changing after spawn.
    """
    # The media worker deliberately imports neither FastAPI nor Pydantic.
    # Keeping validation in this parent cuts per-negotiation cold start on
    # the RK3588 while retaining one crash-isolated PID per negotiation.
    native = shutil.which("eduscope-webrtc-worker", path=os.path.dirname(python_executable))
    args = [native] if native else [python_executable, "-m", "pipeline_manager.pipelines.webrtc_worker"]
    if graph is not None:
        args += ["--graph", graph]
    return tuple(args)


def worker_graph(role: SourceRole, platform: PlatformProfile) -> str:
    """The gst-launch-syntax pipeline body ending in a `webrtcbin` the
    worker negotiates against — audio roles (mic-lecturer) get an
    Opus/RTP branch (a standard WebRTC audio codec, not the platform's own
    `audio_encoder()`, which targets AAC-in-MPEGTS/FLV, not WebRTC);
    video roles get the platform's real encoder at the fixed A-06 frame
    budget (480x270/15fps).
    """
    socket = ROLE_SOCKETS[role]
    if role is SourceRole.MIC_LECTURER:
        return (
            f"shmsrc socket-path={socket} is-live=true do-timestamp=true ! {platform.audio_caps()} ! "
            f"audioconvert ! audioresample ! opusenc ! rtpopuspay pt=97 ! "
            f"application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,payload=97 ! "
            f"webrtcbin name=sendrecv bundle-policy=max-bundle latency=0"
        )

    caps = platform.shm_video_caps(role)
    if role in CAMERA_ROLES:
        decode = f"h264parse ! {' '.join(platform.decoder())} ! "
    else:
        decode = ""
    encoder = " ".join(platform.encoder(get_profile(ProfileKind.THUMBNAIL)))
    return (
        f"shmsrc socket-path={socket} is-live=true do-timestamp=true ! {caps} ! {decode}"
        f"queue max-size-buffers=2 leaky=downstream ! videorate drop-only=true ! "
        f"video/x-raw,framerate={THUMBNAIL_FPS}/1 ! videoscale ! "
        f"video/x-raw,width={THUMBNAIL_WIDTH},height={THUMBNAIL_HEIGHT} ! "
        f"{encoder} ! h264parse config-interval=-1 ! rtph264pay pt=96 ! "
        f"application/x-rtp,media=video,encoding-name=H264,clock-rate=90000,payload=96 ! "
        f"webrtcbin name=sendrecv bundle-policy=max-bundle latency=0"
    )


def _run_gst_worker(graph: str) -> None:  # pragma: no cover - requires PyGObject + Gst on the board/Arch
    """The crash-isolated worker entry point. No `gi` import anywhere above
    this line — unit tests import this module freely without GStreamer
    installed. Serves exactly one negotiation for its whole lifetime (A-07):
    the first `offer` line fixes `negotiation_id`; every outbound message
    echoes it.
    """
    import signal
    import threading

    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GstSdp", "1.0")
    gi.require_version("GstWebRTC", "1.0")
    from gi.repository import GLib, Gst, GstSdp, GstWebRTC

    Gst.init(None)

    pipeline = Gst.parse_launch(graph)
    webrtcbin = pipeline.get_by_name("sendrecv")
    loop = GLib.MainLoop()
    negotiation_id: list[str | None] = [None]

    def _emit(message) -> None:
        print(encode_outbound_message(message), flush=True)

    def _on_ice_candidate(_webrtcbin, mline_index: int, candidate: str) -> None:
        if negotiation_id[0] is None:
            return
        _emit(ThumbnailIceOut(type="ice", negotiation_id=negotiation_id[0], candidate=candidate, sdp_mline_index=mline_index))

    webrtcbin.connect("on-ice-candidate", _on_ice_candidate)

    def _on_answer_created(promise, _element) -> None:
        # Never `.wait()` on a second promise from inside a promise's own
        # change-func — `set-local-description`'s completion runs on the
        # same internal webrtcbin task queue this callback is already
        # occupying, so a nested synchronous wait here deadlocks (verified
        # against a real webrtcbin). `answer.sdp` is already fully formed
        # once `create-answer`'s promise resolves, so nothing here needs to
        # wait for `set-local-description` to finish — fire it and move on.
        promise.wait()
        reply = promise.get_reply()
        answer = reply.get_value("answer")
        webrtcbin.emit("set-local-description", answer, Gst.Promise.new())
        sdp_text = answer.sdp.as_text()
        if negotiation_id[0] is not None:
            _emit(ThumbnailAnswer(type="answer", negotiation_id=negotiation_id[0], sdp=sdp_text))

    def _apply_offer(offer: ThumbnailOffer) -> bool:
        negotiation_id[0] = offer.negotiation_id
        ok, sdpmsg = GstSdp.SDPMessage.new()
        GstSdp.sdp_message_parse_buffer(bytes(offer.sdp, "utf-8"), sdpmsg)
        desc = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.OFFER, sdpmsg)
        remote_promise = Gst.Promise.new()
        webrtcbin.emit("set-remote-description", desc, remote_promise)
        remote_promise.wait()
        answer_promise = Gst.Promise.new_with_change_func(_on_answer_created, webrtcbin)
        webrtcbin.emit("create-answer", None, answer_promise)
        return False

    def _apply_ice(ice: ThumbnailIce) -> bool:
        webrtcbin.emit("add-ice-candidate", ice.sdp_mline_index or 0, ice.candidate)
        return False

    def _apply_close(_close: ThumbnailClose) -> bool:
        print("Got EOS", flush=True)
        loop.quit()
        return False

    def _stdin_reader() -> None:
        for raw_line in sys.stdin:
            line = raw_line.rstrip("\n")
            if not line:
                continue
            try:
                message = parse_control_line(line)
            except InvalidControlMessage as exc:
                print(f"invalid control line ignored: {exc}", file=sys.stderr, flush=True)
                continue
            if isinstance(message, ThumbnailOffer):
                GLib.idle_add(_apply_offer, message)
            elif isinstance(message, ThumbnailIce):
                GLib.idle_add(_apply_ice, message)
            elif isinstance(message, ThumbnailClose):
                GLib.idle_add(_apply_close, message)

    threading.Thread(target=_stdin_reader, daemon=True).start()

    bus = pipeline.get_bus()

    def _on_bus_message(_bus, message: "Gst.Message") -> bool:
        if message.type == Gst.MessageType.EOS:
            print("Got EOS", flush=True)
            loop.quit()
        elif message.type == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            if negotiation_id[0] is not None:
                _emit(ThumbnailWorkerError(type="error", negotiation_id=negotiation_id[0], code="pipeline-error", message=str(err)))
            print(f"ERROR: {err} {debug or ''}", flush=True)
            loop.quit()
        elif message.type == Gst.MessageType.STATE_CHANGED and message.src == pipeline:
            _old, new, _pending = message.parse_state_changed()
            if new == Gst.State.PLAYING:
                print("PLAYING", flush=True)
                if negotiation_id[0] is not None:
                    _emit(ThumbnailPlaying(type="playing", negotiation_id=negotiation_id[0]))
        return True

    bus.add_signal_watch()
    bus.connect("message", _on_bus_message)

    def _on_sigint() -> bool:
        # Unlike record/snapshot/projector, this graph ends in `webrtcbin`
        # reading a *live* `shmsrc`, not a conventional terminating sink —
        # `pipeline.send_event(Gst.Event.new_eos())` here was verified to
        # block indefinitely (never returns, so `loop.quit()` never even
        # runs), stalling until `stop_process`'s deadline forces a SIGKILL.
        # There is no file/mux to finalize for a WebRTC session, so there is
        # nothing an EOS walk would buy anyway — acknowledge the stop
        # request immediately and let `finally` below tear the pipeline
        # down to NULL directly.
        print("Got EOS", flush=True)
        loop.quit()
        return False

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, _on_sigint)

    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)


def _run_loopback_probe(
    *, base_url: str, role: SourceRole, iterations: int, hold_seconds: float = 0
) -> dict:  # pragma: no cover - requires PyGObject + Gst WebRTC on the board
    """Negotiate a real receive-only WebRTC peer through the localhost API.

    The timer starts immediately before the offer is posted and stops on the
    first decoded frame.  Signalling uses the same authenticated HTTP/SSE
    surface as core-api; no in-process shortcut can make this benchmark pass.
    """
    import queue
    import threading
    import urllib.request

    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GstSdp", "1.0")
    gi.require_version("GstWebRTC", "1.0")
    from gi.repository import GLib, Gst, GstSdp, GstWebRTC

    token = os.environ.get("EDUSCOPE_PM_TOKEN")
    if not token:
        raise RuntimeError("set EDUSCOPE_PM_TOKEN")
    headers = {"Authorization": f"Bearer {token}"}

    def request(method: str, path: str, payload: dict | None = None) -> bytes:
        body = None if payload is None else json.dumps(payload).encode()
        req_headers = dict(headers)
        if body is not None:
            req_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base_url + path, data=body, headers=req_headers, method=method)
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.read()

    signals: "queue.Queue[dict]" = queue.Queue()

    def read_events() -> None:
        req = urllib.request.Request(base_url + "/events", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=max(30, iterations * (hold_seconds + 10))) as response:
                event_kind = ""
                for raw in response:
                    line = raw.decode("utf-8", "replace").rstrip("\r\n")
                    if line.startswith("event:"):
                        event_kind = line[6:].strip()
                    elif line.startswith("data:") and event_kind == "evt.pm.thumbnails.signal":
                        signals.put(json.loads(line[5:].strip()))
        except Exception as exc:
            signals.put({"type": "probe-error", "message": str(exc)})

    threading.Thread(target=read_events, daemon=True).start()
    Gst.init(None)
    results: list[dict] = []

    for index in range(iterations):
        negotiation_id = f"a16-{role.value}-{uuid.uuid4().hex}"
        loop = GLib.MainLoop()
        pipeline = Gst.parse_launch(
            "webrtcbin name=peer bundle-policy=max-bundle latency=0 "
            "queue name=recvq ! rtph264depay ! h264parse ! decodebin ! "
            "videoconvert ! fakesink name=decoded sync=false signal-handoffs=true"
        )
        peer = pipeline.get_by_name("peer")
        recvq = pipeline.get_by_name("recvq")
        sink = pipeline.get_by_name("decoded")
        first_frame_ns: list[int | None] = [None]
        started_ns: list[int | None] = [None]
        failure: list[str | None] = [None]
        milestones: dict[str, int] = {}

        def mark(name: str) -> None:
            start = started_ns[0]
            if start is not None and name not in milestones:
                milestones[name] = round((time.monotonic_ns() - start) / 1_000_000)

        def on_pad_added(_peer, pad) -> None:
            mark("receive_pad_ms")
            sink_pad = recvq.get_static_pad("sink")
            if not sink_pad.is_linked():
                pad.link(sink_pad)

        def on_handoff(_sink, _buffer, _pad) -> None:
            if first_frame_ns[0] is None:
                first_frame_ns[0] = time.monotonic_ns()
                loop.quit()

        def on_local_ice(_peer, mline_index: int, candidate: str) -> None:
            def send() -> None:
                try:
                    request("POST", f"/consumers/thumbnails/{negotiation_id}/ice", {
                        "candidate": candidate, "sdpMLineIndex": mline_index,
                    })
                except Exception as exc:
                    failure[0] = f"local ICE forwarding failed: {exc}"
                    GLib.idle_add(loop.quit)
            threading.Thread(target=send, daemon=True).start()

        def on_offer_created(promise, _peer) -> None:
            promise.wait()
            reply = promise.get_reply()
            offer = reply.get_value("offer") if reply is not None else None
            if offer is None:
                detail = reply.to_string() if reply is not None else "no promise reply"
                failure[0] = f"create-offer returned no SDP: {detail}"
                loop.quit()
                return
            peer.emit("set-local-description", offer, Gst.Promise.new())
            started_ns[0] = time.monotonic_ns()

            def send_offer() -> None:
                try:
                    request("POST", "/consumers/thumbnails/offer", {
                        "negotiationId": negotiation_id,
                        "roleId": role.value,
                        "sdp": offer.sdp.as_text(),
                    })
                    mark("offer_http_ms")
                except Exception as exc:
                    failure[0] = f"offer failed: {exc}"
                    GLib.idle_add(loop.quit)
            threading.Thread(target=send_offer, daemon=True).start()

        def poll_signals() -> bool:
            try:
                while True:
                    message = signals.get_nowait()
                    if message.get("type") == "probe-error":
                        failure[0] = message.get("message", "SSE reader failed")
                        loop.quit()
                        return False
                    if message.get("negotiationId") != negotiation_id:
                        continue
                    if message.get("type") == "answer":
                        mark("answer_ms")
                        _ok, sdp = GstSdp.SDPMessage.new()
                        GstSdp.sdp_message_parse_buffer(message["sdp"].encode(), sdp)
                        answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdp)
                        peer.emit("set-remote-description", answer, Gst.Promise.new())
                    elif message.get("type") == "ice":
                        mark("remote_ice_ms")
                        peer.emit("add-ice-candidate", message.get("sdpMLineIndex") or 0, message["candidate"])
                    elif message.get("type") == "error":
                        failure[0] = message.get("message", "remote worker failed")
                        loop.quit()
                        return False
            except queue.Empty:
                return True

        def timeout() -> bool:
            failure[0] = "first decoded frame timeout"
            loop.quit()
            return False

        peer.connect("pad-added", on_pad_added)
        peer.connect("on-ice-candidate", on_local_ice)
        sink.connect("handoff", on_handoff)
        caps = Gst.Caps.from_string("application/x-rtp,media=video,encoding-name=H264,clock-rate=90000,payload=96")
        peer.emit("add-transceiver", GstWebRTC.WebRTCRTPTransceiverDirection.RECVONLY, caps)
        poll_source = GLib.timeout_add(20, poll_signals)
        timeout_source = GLib.timeout_add_seconds(10, timeout)
        pipeline.set_state(Gst.State.PLAYING)
        peer.emit("create-offer", None, Gst.Promise.new_with_change_func(on_offer_created, peer))
        loop.run()
        for source_id in (poll_source, timeout_source):
            source = GLib.MainContext.default().find_source_by_id(source_id)
            if source is not None:
                source.destroy()

        result: dict = {
            "iteration": index + 1,
            "first_frame_ms": None,
            **milestones,
        }
        if failure[0] is not None or started_ns[0] is None or first_frame_ns[0] is None:
            result["error"] = failure[0] or "negotiation produced no frame"
        else:
            first_frame_ms = (first_frame_ns[0] - started_ns[0]) / 1_000_000
            result["first_frame_ms"] = round(first_frame_ms, 3)
        try:
            active_status = json.loads(request("GET", "/status"))
            worker = next(
                (item for item in active_status["consumers"] if item["id"] == f"thumbnails:{negotiation_id}"),
                None,
            )
            if worker is None or worker.get("pgid") is None:
                result["error"] = result.get("error", "thumbnail worker was not visible in /status")
            else:
                result["worker_pgid"] = worker["pgid"]
            results.append(result)
            if hold_seconds and result["first_frame_ms"] is not None:
                time.sleep(hold_seconds)
        finally:
            try:
                request("DELETE", f"/consumers/thumbnails/{negotiation_id}")
            finally:
                pipeline.set_state(Gst.State.NULL)
                pipeline.get_state(2 * Gst.SECOND)
        close_deadline = time.monotonic() + 5
        while True:
            closed_status = json.loads(request("GET", "/status"))
            if not any(item["id"] == f"thumbnails:{negotiation_id}" for item in closed_status["consumers"]):
                results[-1]["worker_closed"] = True
                break
            if time.monotonic() >= close_deadline:
                results[-1]["worker_closed"] = False
                results[-1]["error"] = "thumbnail worker remained in /status after close"
                break
            time.sleep(0.05)

    return {"role": role.value, "results": results}


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--graph")
    parser.add_argument("--loopback-probe", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8091")
    parser.add_argument("--role", choices=[role.value for role in THUMBNAIL_ALLOWED_ROLES])
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--hold-seconds", type=float, default=0)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args(argv)


def main() -> None:  # pragma: no cover - board/Arch-only
    args = _parse_args(sys.argv[1:])
    if args.worker:
        if not args.graph:
            raise SystemExit("--worker requires --graph")
        _run_gst_worker(args.graph)
        return
    if args.loopback_probe:
        if not args.role:
            raise SystemExit("--loopback-probe requires --role")
        result = _run_loopback_probe(
            base_url=args.base_url,
            role=SourceRole(args.role),
            iterations=args.iterations,
            hold_seconds=args.hold_seconds,
        )
        if args.json:
            print(json.dumps(result, separators=(",", ":")))
        return
    raise SystemExit("select --worker or --loopback-probe")


if __name__ == "__main__":  # pragma: no cover
    main()
