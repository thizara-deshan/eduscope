from __future__ import annotations

import json

import pytest

from pipeline_manager.models import SourceRole
from pipeline_manager.pipelines.thumbnails import (
    ENCODE_RESERVATION_KIND,
    THUMBNAIL_ALLOWED_ROLES,
    THUMBNAIL_FPS,
    THUMBNAIL_HEIGHT,
    THUMBNAIL_WIDTH,
    InvalidControlMessage,
    ThumbnailClose,
    ThumbnailIce,
    ThumbnailOffer,
    parse_control_line,
    worker_argv,
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
