from __future__ import annotations

import json

import pytest

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.thumbnails import (
    ENCODE_RESERVATION_KIND,
    THUMBNAIL_ALLOWED_ROLES,
    THUMBNAIL_FPS,
    THUMBNAIL_HEIGHT,
    THUMBNAIL_WIDTH,
    InvalidControlMessage,
    ThumbnailAnswer,
    ThumbnailClose,
    ThumbnailIce,
    ThumbnailIceOut,
    ThumbnailOffer,
    ThumbnailPlaying,
    ThumbnailWorkerError,
    encode_outbound_message,
    parse_control_line,
    parse_worker_output_line,
    worker_argv,
    worker_graph,
)


def test_frame_limits_are_480x270_15fps() -> None:
    assert (THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, THUMBNAIL_FPS) == (480, 270, 15)


def test_encode_reservation_is_thumbnail() -> None:
    assert ENCODE_RESERVATION_KIND == "thumbnail"


def test_role_allowlist_excludes_mic_room() -> None:
    assert SourceRole.MIC_ROOM not in THUMBNAIL_ALLOWED_ROLES
    assert SourceRole.PRESENTATION in THUMBNAIL_ALLOWED_ROLES


def test_offer_rejects_mic_room() -> None:
    line = json.dumps(
        {"type": "offer", "negotiation_id": "n1", "role_id": "mic-room", "sdp": "v=0..."}
    )
    with pytest.raises(InvalidControlMessage):
        parse_control_line(line)


class TestControlLineValidation:
    def test_valid_offer_parses(self) -> None:
        line = json.dumps(
            {"type": "offer", "negotiation_id": "n1", "role_id": "presentation", "sdp": "v=0..."}
        )
        message = parse_control_line(line)
        assert isinstance(message, ThumbnailOffer)
        assert message.negotiation_id == "n1"

    def test_valid_ice_parses(self) -> None:
        line = json.dumps(
            {
                "type": "ice",
                "negotiation_id": "n1",
                "candidate": "candidate:1 1 UDP 2 10.0.0.1 5000 typ host",
                "sdp_mid": "0",
                "sdp_mline_index": 0,
            }
        )
        message = parse_control_line(line)
        assert isinstance(message, ThumbnailIce)

    def test_valid_close_parses(self) -> None:
        message = parse_control_line(json.dumps({"type": "close", "negotiation_id": "n1"}))
        assert isinstance(message, ThumbnailClose)

    def test_malformed_json_rejected(self) -> None:
        with pytest.raises(InvalidControlMessage):
            parse_control_line("{not json")

    def test_unknown_type_rejected(self) -> None:
        with pytest.raises(InvalidControlMessage):
            parse_control_line(json.dumps({"type": "leaderboard", "negotiation_id": "n1"}))

    def test_extra_fields_rejected(self) -> None:
        line = json.dumps(
            {
                "type": "offer",
                "negotiation_id": "n1",
                "role_id": "presentation",
                "sdp": "v=0...",
                "extraField": "nope",
            }
        )
        with pytest.raises(InvalidControlMessage):
            parse_control_line(line)

    def test_oversize_sdp_rejected(self) -> None:
        line = json.dumps(
            {"type": "offer", "negotiation_id": "n1", "role_id": "presentation", "sdp": "x" * 131_073}
        )
        with pytest.raises(InvalidControlMessage):
            parse_control_line(line)

    def test_json_array_rejected(self) -> None:
        with pytest.raises(InvalidControlMessage):
            parse_control_line(json.dumps([1, 2, 3]))


def test_worker_argv_is_one_process_per_invocation() -> None:
    argv = worker_argv("python3")
    assert argv[0] == "python3"
    assert "--worker" in argv


def test_worker_argv_carries_the_graph_as_a_single_argv_element() -> None:
    """SDP/ICE themselves still travel over stdin (never argv) because
    they're per-negotiation and keep changing after spawn — only the
    static pipeline topology (fixed once `role_id` is known) is baked in."""
    argv = worker_argv("python3", graph="shmsrc ! fakesink")
    assert "--graph" in argv
    assert "shmsrc ! fakesink" in argv


class TestWorkerGraph:
    def test_video_role_reads_from_its_shm_socket(self) -> None:
        graph = worker_graph(SourceRole.PRESENTATION, RK3588Profile())
        assert "socket-path=/tmp/usb.sock" in graph
        assert "webrtcbin name=sendrecv" in graph

    def test_camera_role_decodes_before_scaling(self) -> None:
        graph = worker_graph(SourceRole.LECTURER_CAM, RK3588Profile())
        assert "h264parse" in graph
        assert "mppvideodec" in graph

    def test_video_role_uses_the_fixed_frame_budget(self) -> None:
        graph = worker_graph(SourceRole.PRESENTATION, RK3588Profile())
        assert f"width={THUMBNAIL_WIDTH},height={THUMBNAIL_HEIGHT}" in graph
        assert f"framerate={THUMBNAIL_FPS}/1" in graph

    def test_video_role_uses_the_platform_encoder(self) -> None:
        graph = worker_graph(SourceRole.PRESENTATION, RK3588Profile())
        assert "mpph264enc" in graph
        assert "rtph264pay" in graph

    def test_mic_role_uses_opus_not_the_platform_audio_encoder(self) -> None:
        """WebRTC needs Opus, not the platform's AAC/mpegts-shaped audio
        encoder — `opusenc` is a stock element, not RK3588-specific."""
        graph = worker_graph(SourceRole.MIC_LECTURER, RK3588Profile())
        assert "socket-path=/tmp/audio.sock" in graph
        assert "opusenc" in graph
        assert "rtpopuspay" in graph
        assert "voaacenc" not in graph


class TestOutboundMessages:
    def test_answer_round_trips_through_parse_worker_output_line(self) -> None:
        message = ThumbnailAnswer(type="answer", negotiation_id="n1", sdp="v=0...answer")
        line = encode_outbound_message(message)
        assert parse_worker_output_line(line) == message

    def test_ice_out_round_trips(self) -> None:
        message = ThumbnailIceOut(type="ice", negotiation_id="n1", candidate="candidate:1", sdp_mline_index=0)
        line = encode_outbound_message(message)
        assert parse_worker_output_line(line) == message

    def test_error_round_trips(self) -> None:
        message = ThumbnailWorkerError(type="error", negotiation_id="n1", code="pipeline-error", message="boom")
        line = encode_outbound_message(message)
        assert parse_worker_output_line(line) == message

    def test_playing_round_trips(self) -> None:
        message = ThumbnailPlaying(type="playing", negotiation_id="n1")
        line = encode_outbound_message(message)
        assert parse_worker_output_line(line) == message

    def test_a_bus_status_line_is_not_a_signaling_frame(self) -> None:
        assert parse_worker_output_line("PLAYING") is None
        assert parse_worker_output_line("Got EOS") is None
        assert parse_worker_output_line("ERROR: something broke") is None

    def test_arbitrary_text_is_ignored_not_raised(self) -> None:
        assert parse_worker_output_line("not json at all") is None
