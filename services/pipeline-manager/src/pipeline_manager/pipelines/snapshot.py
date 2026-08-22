from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from ..models import SourceRole
from .builder import ROLE_SOCKETS, PipelineSpec
from .platforms.base import PlatformProfile


class InvalidSnapshotInterval(ValueError):
    pass


class SnapshotNotReady(ValueError):
    pass


@dataclass(frozen=True)
class SnapshotRequest:
    interval_sec: int
    output_path: str


def temp_path_for(output_path: str) -> str:
    return f"{output_path}.tmp"


def worker_argv(
    interval_sec: int,
    output_path: str,
    video_caps: str,
    python_executable: str = sys.executable,
) -> tuple[str, ...]:
    """One long-running worker per snapshot consumer (A-REV-010): the
    supervisor spawns/monitors/stops it exactly like every other child
    (argv, PGID, SIGINT->EOS bus-line contract), but the worker itself calls
    `publish_snapshot` from Python after every frame `multifilesink`
    finishes writing — no plain `gst-launch-1.0` CLI process can invoke
    Python per-buffer, so a gst-launch argv can never publish atomically
    (the reason the old pipeline just appended raw PNG-encoded buffers into
    one corrupt `filesink` blob and never called `publish_snapshot` at all).
    `video_caps` carries the platform's presentation shm caps in from
    `build_snapshot` — the worker never re-derives platform-specific caps.
    """
    return (
        python_executable,
        "-m",
        "pipeline_manager.pipelines.snapshot",
        "--worker",
        "--interval-sec",
        str(interval_sec),
        "--output-path",
        output_path,
        "--video-caps",
        video_caps,
    )


def build_snapshot(req: SnapshotRequest, platform: PlatformProfile) -> PipelineSpec:
    if req.interval_sec < 1:
        raise InvalidSnapshotInterval("intervalSec must be >= 1")

    argv = worker_argv(req.interval_sec, req.output_path, platform.shm_video_caps(SourceRole.PRESENTATION))
    return PipelineSpec(
        argv=argv,
        required_roles=(SourceRole.PRESENTATION,),
        encode_slots=0,
        outputs=(req.output_path,),
    )


def publish_snapshot(tmp_path: Path, final_path: Path) -> None:
    """Confirm nonzero size, fsync, then atomically publish — no consumer ever
    observes a partial final PNG (a crash mid-write leaves only the .tmp sibling).
    """
    size = tmp_path.stat().st_size
    if size <= 0:
        raise SnapshotNotReady(f"{tmp_path} is empty")
    with tmp_path.open("rb+") as handle:
        os.fsync(handle.fileno())
    os.replace(tmp_path, final_path)


def worker_graph(interval_sec: int, tmp_path: str, video_caps: str) -> str:
    """The gst-launch-syntax pipeline *body* (no `gst-launch-1.0 -e -m`
    prefix — the worker parses this itself via `Gst.parse_launch`).
    `multifilesink` in `next-file=buffer` mode with a fixed (non-`%d`)
    `location` overwrites the same tmp file on every frame;
    `post-messages=true` is how the worker's bus watch learns each write
    finished, so it can `publish_snapshot` it (verified against a real
    `multifilesink`: it posts an element message named `GstMultiFileSink`
    with a `filename` field once the file is closed).
    """
    socket = ROLE_SOCKETS[SourceRole.PRESENTATION]
    return (
        f"shmsrc socket-path={socket} is-live=true do-timestamp=true ! "
        f"{video_caps} ! videorate ! video/x-raw,framerate=1/{interval_sec} ! videoconvert ! "
        f"pngenc snapshot=false ! "
        f"multifilesink name=sink location={tmp_path} next-file=buffer post-messages=true"
    )


def _run_gst_worker(interval_sec: int, output_path: str, video_caps: str) -> None:  # pragma: no cover - requires PyGObject + Gst on the board/Arch
    """The crash-isolated worker entry point (board/Arch-only — needs a real
    GStreamer + PyGObject install). No `gi` import anywhere above this line,
    so unit tests import this module freely without GStreamer installed.
    """
    import signal

    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GLibUnix", "2.0")
    from gi.repository import GLib, GLibUnix, Gst

    Gst.init(None)

    tmp_path = temp_path_for(output_path)
    pipeline = Gst.parse_launch(worker_graph(interval_sec, tmp_path, video_caps))
    bus = pipeline.get_bus()
    loop = GLib.MainLoop()
    tmp = Path(tmp_path)
    final = Path(output_path)

    def _on_message(_bus, message: "Gst.Message") -> bool:
        if message.type == Gst.MessageType.ELEMENT:
            structure = message.get_structure()
            if structure is not None and structure.get_name() == "GstMultiFileSink":
                try:
                    publish_snapshot(tmp, final)
                except (SnapshotNotReady, OSError) as exc:
                    print(f"snapshot publish skipped: {exc}", file=sys.stderr, flush=True)
        elif message.type == Gst.MessageType.EOS:
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
        return False  # one-shot: GLib removes this source after it returns False

    GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, _on_sigint)

    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)


def _parse_worker_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--interval-sec", type=int, required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--video-caps", required=True)
    return parser.parse_args(argv)


def main() -> None:  # pragma: no cover - board/Arch-only
    args = _parse_worker_args(sys.argv[1:])
    _run_gst_worker(args.interval_sec, args.output_path, args.video_caps)


if __name__ == "__main__":  # pragma: no cover
    main()
