from __future__ import annotations

from ...models import SourceRole
from .base import DisplayOut, EncodeProfileLike, Pad, PlacementFn

_VIDEO_ROLES = {
    SourceRole.PRESENTATION: "video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1",
    SourceRole.LECTURER_CAM: (
        "video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1"
    ),
    SourceRole.STUDENTS_CAM: (
        "video/x-h264,stream-format=byte-stream,alignment=au,width=1920,height=1080,framerate=30/1"
    ),
}

_REQUIRED_ELEMENTS = [
    "shmsrc",
    "shmsink",
    "mpph264enc",
    "mppvideodec",
    "videoconvert",
    "videoscale",
    "compositor",
    "voaacenc",
    "aacparse",
    "mpegtsmux",
    "flvmux",
    "xvimagesink",
    "alsasink",
    "rtmpsink",
    "webrtcbin",
]


class RK3588Profile:
    """The only production module allowed to name RK3588 GStreamer elements (rule 1)."""

    id = "rk3588"

    def shm_video_caps(self, role: SourceRole) -> str:
        try:
            return _VIDEO_ROLES[role]
        except KeyError as exc:
            raise ValueError(f"{role.value} has no shm video caps") from exc

    def audio_caps(self) -> str:
        return "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved"

    def decoder(self) -> list[str]:
        return ["mppvideodec"]

    def convert(self) -> list[str]:
        return ["videoconvert"]

    def scale(self) -> list[str]:
        return ["videoscale"]

    def compositor(self, name: str, pads: list[Pad]) -> list[str]:
        tokens = ["compositor", f"name={name}", "background=black"]
        for pad in pads:
            tokens.append(f"{pad.name}::xpos={pad.xpos}")
            tokens.append(f"{pad.name}::ypos={pad.ypos}")
        return tokens

    def encoder(self, profile: EncodeProfileLike) -> list[str]:
        return [
            "mpph264enc",
            f"bps={profile.video_bitrate_bps}",
            f"rc-mode={profile.rc_mode}",
            f"gop={profile.gop}",
            f"profile={profile.h264_profile}",
        ]

    def audio_encoder(self, profile: EncodeProfileLike) -> list[str]:
        return ["voaacenc", f"bitrate={profile.audio_bitrate_bps}", "!", "aacparse"]

    def mux(self, kind: str, name: str) -> list[str]:
        if kind == "mpegts":
            return ["mpegtsmux", f"name={name}", "alignment=7"]
        if kind == "flv":
            return ["flvmux", f"name={name}", "streamable=true"]
        raise ValueError(f"unsupported mux kind: {kind}")

    def display_sink(self, output: DisplayOut) -> list[str]:
        return ["xvimagesink", "sync=false"]

    def rtmp_sink(self, url: str) -> list[str]:
        return ["rtmpsink", f"location={url}", "sync=false"]

    def file_sink(self, path: str) -> list[str]:
        return ["filesink", f"location={path}"]

    def display_place(self, output: DisplayOut) -> PlacementFn:
        def _placement() -> list[str]:
            return ["wmctrl", "-r", ":ACTIVE:", "-b", "add,fullscreen"]

        return _placement

    def required_elements(self) -> list[str]:
        return list(_REQUIRED_ELEMENTS)
