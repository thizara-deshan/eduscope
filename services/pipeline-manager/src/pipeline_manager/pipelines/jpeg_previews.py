from __future__ import annotations

import argparse
import os
import signal
import sys
from pathlib import Path

from ..models import SourceRole
from .builder import CAMERA_ROLES, ROLE_SOCKETS, PipelineSpec
from .platforms.base import PlatformProfile

JPEG_PREVIEW_ROLES = (
    SourceRole.PRESENTATION,
    SourceRole.LECTURER_CAM,
    SourceRole.STUDENTS_CAM,
)
WIDTH = 480
HEIGHT = 270


def build_jpeg_previews(output_dir: Path, platform: PlatformProfile) -> PipelineSpec:
    argv = (sys.executable, "-m", "pipeline_manager.pipelines.jpeg_previews", "--worker",
            "--output-dir", str(output_dir))
    return PipelineSpec(argv, JPEG_PREVIEW_ROLES, 0,
                        tuple(str(output_dir / f"{role.value}.jpg") for role in JPEG_PREVIEW_ROLES))


def worker_graph(output_dir: Path, platform: PlatformProfile) -> str:
    branches: list[str] = []
    for role in JPEG_PREVIEW_ROLES:
        decode = f"h264parse ! {' '.join(platform.decoder())} ! " if role in CAMERA_ROLES else ""
        branches.append(
            f"shmsrc socket-path={ROLE_SOCKETS[role]} is-live=true do-timestamp=true ! "
            f"{platform.shm_video_caps(role)} ! {decode}queue max-size-buffers=2 leaky=downstream ! "
            f"videorate drop-only=true max-rate=1 ! videoscale ! "
            f"video/x-raw,width={WIDTH},height={HEIGHT},framerate=1/1 ! "
            f"videoconvert ! jpegenc quality=70 ! multifilesink name=sink_{role.value.replace('-', '_')} "
            f"location={output_dir / (role.value + '.jpg.tmp')} next-file=buffer post-messages=true"
        )
    return " ".join(branches)


def _publish(tmp: Path) -> None:
    if not tmp.is_file() or tmp.stat().st_size == 0:
        return
    with tmp.open("rb+") as handle:
        os.fsync(handle.fileno())
    os.replace(tmp, Path(str(tmp)[:-4]))


def run_worker(output_dir: Path) -> None:  # pragma: no cover - real GStreamer target only
    import gi
    gi.require_version("Gst", "1.0")
    from gi.repository import GLib, Gst

    output_dir.mkdir(parents=True, exist_ok=True)
    Gst.init(None)
    pipeline = Gst.parse_launch(worker_graph(output_dir, __import__(
        "pipeline_manager.pipelines.platforms.rk3588", fromlist=["RK3588Profile"]
    ).RK3588Profile()))
    loop = GLib.MainLoop()
    bus = pipeline.get_bus()

    def message(_bus, msg) -> bool:
        if msg.type == Gst.MessageType.ELEMENT:
            structure = msg.get_structure()
            if structure and structure.get_name() == "GstMultiFileSink":
                filename = structure.get_string("filename")
                if filename:
                    _publish(Path(filename))
        elif msg.type == Gst.MessageType.ERROR:
            error, debug = msg.parse_error()
            print(f"ERROR: {error} {debug or ''}", flush=True)
            loop.quit()
        elif msg.type == Gst.MessageType.EOS:
            print("Got EOS", flush=True)
            loop.quit()
        elif msg.type == Gst.MessageType.STATE_CHANGED and msg.src == pipeline:
            _old, new, _pending = msg.parse_state_changed()
            if new == Gst.State.PLAYING:
                print("PLAYING", flush=True)
        return True

    bus.add_signal_watch()
    handler = bus.connect("message", message)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT,
                         lambda: (pipeline.send_event(Gst.Event.new_eos()), False)[1])
    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        bus.disconnect(handler)
        bus.remove_signal_watch()
        pipeline.set_state(Gst.State.NULL)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run_worker(args.output_dir)


if __name__ == "__main__":
    main()
