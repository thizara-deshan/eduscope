from __future__ import annotations

import argparse
import json
import sys
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..models import SourceRole
from .builder import DisplayPlacement, PipelineSpec
from .platforms.base import DisplayOut, PlatformProfile


class ProjectorMode(str, Enum):
    PASSTHROUGH = "passthrough"
    QUESTION = "question"


class ProjectorOption(BaseModel):
    """One answer option — the exact internal shape B sends (core-api
    `PmProjectorRequest.questionPayload.options[]`), reconciled here so A
    accepts B's payload without a translation DTO (E-49)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: Literal["A", "B", "C", "D"]
    text: str = Field(min_length=1, max_length=300)


class QuestionOverlay(BaseModel):
    """The one canonical internal projector payload — identical to B's
    `PmProjectorRequest` question payload. `extra='forbid'` makes
    leaderboard/answer/participant/score fields structurally impossible
    (A-22, Q-31): this is a slide overlay, not a quiz result view."""

    model_config = ConfigDict(extra="forbid")

    publicationId: str
    prompt: str = Field(min_length=1, max_length=500)
    options: list[ProjectorOption] = Field(min_length=2, max_length=4)
    correctOptionId: str | None = None
    joinUrl: str
    joinCode: str


class ProjectorCard(BaseModel):
    """The rendered-card handle carried to the worker: A renders the whole
    1920×1080 question card server-side (`overlays.render_question_card`) and
    the worker only swaps one `gdkpixbufoverlay.location` to this PNG path —
    never any question text, so nothing sensitive touches argv or a GObject
    property string."""

    model_config = ConfigDict(extra="forbid")

    card_png_path: str = Field(min_length=1)


class ProjectorControlMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: ProjectorMode
    card: ProjectorCard | None = None


def encode_control_message(mode: ProjectorMode, card_png_path: str | None = None) -> bytes:
    """Length-delimited JSON control frame written to the worker's stdin.

    For question mode the frame carries only the rendered card's PNG path; the
    question text/options/QR are already baked into that image, never
    interpolated into argv (A-22).
    """
    card = ProjectorCard(card_png_path=card_png_path) if card_png_path is not None else None
    message = ProjectorControlMessage(mode=mode, card=card)
    body = message.model_dump_json().encode("utf-8")
    return f"{len(body)}\n".encode("ascii") + body


class InvalidControlFrame(ValueError):
    pass


def decode_control_message(header: str, body: bytes) -> ProjectorControlMessage:
    """The read-side counterpart of `encode_control_message`: `header` is the
    ASCII decimal length line (already stripped of its trailing `\\n`),
    `body` is exactly that many bytes. Used by the worker's stdin reader and
    directly by tests — never by argv (A-22)."""
    try:
        expected = int(header)
    except ValueError as exc:
        raise InvalidControlFrame(f"invalid control frame length header: {header!r}") from exc
    if expected != len(body):
        raise InvalidControlFrame(f"control frame length mismatch: header={expected} body={len(body)}")
    try:
        raw = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidControlFrame(f"invalid control frame JSON: {exc}") from exc
    try:
        return ProjectorControlMessage.model_validate(raw)
    except Exception as exc:  # pydantic ValidationError
        raise InvalidControlFrame(str(exc)) from exc


# Question-slide backdrop caps (5 fps is plenty for a static text+QR card).
_SLIDE_CAPS = "video/x-raw,format=I420,width=1920,height=1080,framerate=5/1"


# Test-only worker seam (E-49 A+B+D integration): when this env var is set the
# projector spawns a stdin-draining child instead of the real GStreamer worker,
# so the A FastAPI process can accept mode switches and render real cards
# without a GStreamer/HDMI display. Never set in production (create_production_app
# leaves it unset), so `build_projector` always returns the real argv on-board.
_FAKE_WORKER_ENV = "EDUSCOPE_PM_PROJECTOR_FAKE_WORKER"
# A long-lived child that reports PLAYING (so the health confirmer clears it),
# drains its stdin (so control frames never fill the pipe), and exits only on
# EOF or signal — exactly the observable liveness the supervisor's restart path
# needs, minus GStreamer.
_FAKE_WORKER_SCRIPT = (
    "import sys\n"
    "sys.stdout.write('PLAYING\\n')\n"
    "sys.stdout.flush()\n"
    "while sys.stdin.buffer.read(1) != b'':\n"
    "    pass\n"
)


def worker_argv(
    video_caps: str,
    display_sink_tokens: str,
    python_executable: str = sys.executable,
) -> tuple[str, ...]:
    """One long-running worker for the projector's whole session (A-REV-009):
    a real `input-selector` picks passthrough vs. the question slide, and the
    rendered question card is a `gdkpixbufoverlay.location` the worker updates
    from stdin control frames — never a pipeline rebuild, so mode switches
    share one PGID.
    """
    import os

    if os.environ.get(_FAKE_WORKER_ENV):
        return (python_executable, "-c", _FAKE_WORKER_SCRIPT)
    return (
        python_executable,
        "-m",
        "pipeline_manager.pipelines.projector",
        "--worker",
        "--video-caps",
        video_caps,
        "--display-sink",
        display_sink_tokens,
    )


def worker_graph(video_caps: str, display_sink_tokens: str) -> str:
    """The gst-launch-syntax pipeline body the worker parses via
    `Gst.parse_launch`. `sel.sink_0` is the live passthrough (PRESENTATION
    shm); `sel.sink_1` is a static slide showing one full-screen rendered
    question card (`gdkpixbufoverlay name=card`) swapped in place for each
    question — `input-selector.active-pad` and `card.location` are the only
    two things a mode switch touches, never a pipeline rebuild.
    """
    from .builder import ROLE_SOCKETS

    socket = ROLE_SOCKETS[SourceRole.PRESENTATION]
    return (
        f"shmsrc socket-path={socket} is-live=true do-timestamp=true ! {video_caps} ! "
        f"queue max-size-buffers=6 leaky=downstream ! videorate drop-only=true ! video/x-raw,framerate=30/1 ! "
        f"sel.sink_0 "
        f"videotestsrc is-live=true pattern=black ! {_SLIDE_CAPS} ! "
        f"gdkpixbufoverlay name=card overlay-width=1920 overlay-height=1080 ! "
        f"sel.sink_1 "
        f"input-selector name=sel ! videoconvert ! {display_sink_tokens}"
    )


def build_projector(platform: PlatformProfile) -> PipelineSpec:
    """One long-running worker with an input-selector; mode switches
    (POST /consumers/projector {mode}) are control messages, never a restart —
    passthrough and question modes always share this same argv/child.
    """
    argv = worker_argv(
        platform.shm_video_caps(SourceRole.PRESENTATION),
        " ".join(platform.display_sink(DisplayOut.HDMI_1)),
    )
    placement = DisplayPlacement(output=DisplayOut.HDMI_1, x=0, y=0, width=1920, height=1080, fullscreen=True)
    return PipelineSpec(
        argv=argv,
        required_roles=(SourceRole.PRESENTATION,),
        encode_slots=0,
        outputs=(),
        placement=placement,
    )


def _run_gst_worker(video_caps: str, display_sink_tokens: str) -> None:  # pragma: no cover - requires PyGObject + Gst on the board/Arch
    """The crash-isolated worker entry point (board/Arch-only). No `gi`
    import anywhere above this line — unit tests import this module freely
    without GStreamer installed.
    """
    import signal
    import threading

    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import GLib, Gst

    Gst.init(None)

    pipeline = Gst.parse_launch(worker_graph(video_caps, display_sink_tokens))
    selector = pipeline.get_by_name("sel")
    card = pipeline.get_by_name("card")
    pads = {ProjectorMode.PASSTHROUGH: selector.get_static_pad("sink_0"), ProjectorMode.QUESTION: selector.get_static_pad("sink_1")}

    bus = pipeline.get_bus()
    loop = GLib.MainLoop()

    def _apply(message: ProjectorControlMessage) -> bool:
        if message.mode is ProjectorMode.QUESTION and message.card is not None:
            card.set_property("location", message.card.card_png_path)
        selector.set_property("active-pad", pads[message.mode])
        return False

    def _stdin_reader() -> None:
        raw_stream = sys.stdin.buffer
        while True:
            header = b""
            while True:
                byte = raw_stream.read(1)
                if not byte:
                    return  # EOF: parent closed stdin, keep serving on signals alone
                if byte == b"\n":
                    break
                header += byte
            try:
                length = int(header)
            except ValueError:
                continue
            body = b""
            while len(body) < length:
                chunk = raw_stream.read(length - len(body))
                if not chunk:
                    return
                body += chunk
            try:
                message = decode_control_message(header.decode("ascii"), body)
            except InvalidControlFrame as exc:
                print(f"invalid control frame ignored: {exc}", file=sys.stderr, flush=True)
                continue
            GLib.idle_add(_apply, message)

    threading.Thread(target=_stdin_reader, daemon=True).start()

    def _on_message(_bus, message: "Gst.Message") -> bool:
        if message.type == Gst.MessageType.EOS:
            print("Got EOS", flush=True)
            loop.quit()
        elif message.type == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            print(f"ERROR: {err} {debug or ''}", flush=True)
            loop.quit()
        elif message.type == Gst.MessageType.STATE_CHANGED and message.src == pipeline:
            _old, new, _pending = message.parse_state_changed()
            if new == Gst.State.PLAYING:
                print("PLAYING", flush=True)
        return True

    bus.add_signal_watch()
    bus.connect("message", _on_message)

    def _on_sigint() -> bool:
        pipeline.send_event(Gst.Event.new_eos())
        return False

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, _on_sigint)

    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)


def _parse_worker_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--video-caps", required=True)
    parser.add_argument("--display-sink", required=True)
    return parser.parse_args(argv)


def main() -> None:  # pragma: no cover - board/Arch-only
    args = _parse_worker_args(sys.argv[1:])
    _run_gst_worker(args.video_caps, args.display_sink)


if __name__ == "__main__":  # pragma: no cover
    main()
