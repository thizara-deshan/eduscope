from __future__ import annotations

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.platforms.base import DisplayOut, Pad, PlatformProfile
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile

REQUIRED = {
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
}


class _FakeProfile:
    id = "rk3588"
    video_bitrate_bps = 4_000_000
    rc_mode = "cbr"
    gop = 30
    h264_profile = "high"
    audio_bitrate_bps = 128_000
    container = "mpegts"


def test_satisfies_platform_profile_protocol() -> None:
    assert isinstance(RK3588Profile(), PlatformProfile)


def test_id_is_rk3588() -> None:
    assert RK3588Profile().id == "rk3588"


def test_required_elements_exact_set() -> None:
    assert set(RK3588Profile().required_elements()) == REQUIRED


def _assert_token_list(result: object) -> None:
    assert isinstance(result, list)
    assert all(isinstance(token, str) and token for token in result)


class TestRoleMethodsReturnTokenLists:
    def test_decoder(self) -> None:
        _assert_token_list(RK3588Profile().decoder())

    def test_convert(self) -> None:
        _assert_token_list(RK3588Profile().convert())

    def test_scale(self) -> None:
        _assert_token_list(RK3588Profile().scale())

    def test_compositor(self) -> None:
        pads = [Pad(name="sink_0", xpos=0, ypos=270, width=960, height=540)]
        tokens = RK3588Profile().compositor("comp", pads)
        _assert_token_list(tokens)
        assert "sink_0::xpos=0" in tokens
        assert "sink_0::ypos=270" in tokens

    def test_encoder(self) -> None:
        tokens = RK3588Profile().encoder(_FakeProfile())
        _assert_token_list(tokens)
        assert tokens[0] == "mpph264enc"
        assert "bps=4000000" in tokens
        assert "gop=30" in tokens

    def test_audio_encoder(self) -> None:
        tokens = RK3588Profile().audio_encoder(_FakeProfile())
        _assert_token_list(tokens)
        assert tokens[0] == "voaacenc"
        assert "aacparse" in tokens

    def test_mux_mpegts(self) -> None:
        tokens = RK3588Profile().mux("mpegts", "mux")
        _assert_token_list(tokens)
        assert tokens[0] == "mpegtsmux"
        assert "alignment=7" in tokens

    def test_mux_flv(self) -> None:
        tokens = RK3588Profile().mux("flv", "mux")
        _assert_token_list(tokens)
        assert tokens[0] == "flvmux"
        assert "streamable=true" in tokens

    def test_display_sink(self) -> None:
        _assert_token_list(RK3588Profile().display_sink(DisplayOut.HDMI_1))

    def test_rtmp_sink(self) -> None:
        tokens = RK3588Profile().rtmp_sink("rtmp://127.0.0.1:1935/live/bench live=1")
        _assert_token_list(tokens)
        assert tokens[0] == "rtmpsink"

    def test_file_sink(self) -> None:
        tokens = RK3588Profile().file_sink("/media/eduscope/recordings/seg.ts")
        _assert_token_list(tokens)
        assert tokens[0] == "filesink"

    def test_shm_video_caps_presentation(self) -> None:
        caps = RK3588Profile().shm_video_caps(SourceRole.PRESENTATION)
        assert isinstance(caps, str)
        assert "NV12" in caps

    def test_shm_video_caps_camera(self) -> None:
        caps = RK3588Profile().shm_video_caps(SourceRole.LECTURER_CAM)
        assert "x-h264" in caps

    def test_shm_video_caps_rejects_audio_role(self) -> None:
        import pytest

        with pytest.raises(ValueError):
            RK3588Profile().shm_video_caps(SourceRole.MIC_LECTURER)

    def test_audio_caps(self) -> None:
        caps = RK3588Profile().audio_caps()
        assert "S16LE" in caps and "48000" in caps

    def test_display_place_returns_callable_producing_argv(self) -> None:
        placement = RK3588Profile().display_place(DisplayOut.HDMI_2)
        argv = placement()
        _assert_token_list(argv)
