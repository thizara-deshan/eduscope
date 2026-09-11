"""GStreamer display worker with an explicitly positioned X11 window."""

from __future__ import annotations

import argparse
import ctypes
import signal
import sys

from .pipelines.builder import DisplayPlacement


def worker_argv(gst_argv: list[str], placement: DisplayPlacement, *, python_executable: str = sys.executable) -> list[str]:
    return [python_executable, "-m", "pipeline_manager.display", "--graph", " ".join(gst_argv[3:]),
            "--x", str(placement.x), "--y", str(placement.y),
            "--width", str(placement.width), "--height", str(placement.height)]


class _XSetWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("background_pixmap", ctypes.c_ulong), ("background_pixel", ctypes.c_ulong),
        ("border_pixmap", ctypes.c_ulong), ("border_pixel", ctypes.c_ulong),
        ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int),
        ("backing_store", ctypes.c_int), ("backing_planes", ctypes.c_ulong),
        ("backing_pixel", ctypes.c_ulong), ("save_under", ctypes.c_int),
        ("event_mask", ctypes.c_long), ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", ctypes.c_int), ("colormap", ctypes.c_ulong),
        ("cursor", ctypes.c_ulong),
    ]


def _create_window(x: int, y: int, width: int, height: int):
    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XCreateSimpleWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
                                        ctypes.c_uint, ctypes.c_uint, ctypes.c_uint,
                                        ctypes.c_ulong, ctypes.c_ulong]
    x11.XCreateSimpleWindow.restype = ctypes.c_ulong
    x11.XChangeWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
    x11.XMapRaised.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDestroyWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError("cannot open X display")
    window = x11.XCreateSimpleWindow(display, x11.XDefaultRootWindow(display), x, y, width, height, 0, 0, 0)
    attributes = _XSetWindowAttributes()
    attributes.override_redirect = 1
    x11.XChangeWindowAttributes(display, window, 1 << 9, ctypes.byref(attributes))
    x11.XMapRaised(display, window)
    x11.XSync(display, 0)
    return x11, display, window


def run(graph: str, x: int, y: int, width: int, height: int) -> None:  # pragma: no cover - board only
    import gi
    gi.require_version("Gst", "1.0")
    gi.require_version("GstVideo", "1.0")
    from gi.repository import GLib, Gst, GstVideo

    Gst.init(None)
    pipeline = Gst.parse_launch(graph)
    sink = pipeline.get_by_name("xvimagesink0")
    if sink is None:
        raise RuntimeError("display pipeline has no xvimagesink")
    x11, display, window = _create_window(x, y, width, height)
    GstVideo.VideoOverlay.set_window_handle(sink, window)
    loop = GLib.MainLoop()

    def on_message(_bus, message) -> bool:
        if message.type == Gst.MessageType.STATE_CHANGED and message.src == pipeline:
            _old, new, _pending = message.parse_state_changed()
            if new == Gst.State.PLAYING:
                print("PLAYING", flush=True)
        elif message.type == Gst.MessageType.EOS:
            print("Got EOS", flush=True)
            loop.quit()
        elif message.type == Gst.MessageType.ERROR:
            error, debug = message.parse_error()
            print(f"ERROR: {error} {debug or ''}", flush=True)
            loop.quit()
        return True

    bus = pipeline.get_bus()
    bus.add_signal_watch()
    bus.connect("message", on_message)

    def stop() -> bool:
        pipeline.send_event(Gst.Event.new_eos())
        return False

    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, stop)
    pipeline.set_state(Gst.State.PLAYING)
    try:
        loop.run()
    finally:
        pipeline.set_state(Gst.State.NULL)
        x11.XDestroyWindow(display, window)
        x11.XCloseDisplay(display)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", required=True)
    parser.add_argument("--x", required=True, type=int)
    parser.add_argument("--y", required=True, type=int)
    parser.add_argument("--width", required=True, type=int)
    parser.add_argument("--height", required=True, type=int)
    args = parser.parse_args()
    run(args.graph, args.x, args.y, args.width, args.height)


if __name__ == "__main__":
    main()
