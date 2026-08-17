from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline_manager.config import Settings
from pipeline_manager.models import (
    LayoutPresetId,
    PublisherBinding,
    PublisherId,
    Ratio,
    SourceRole,
    resolve_output_path,
)


def test_v1_source_and_preset_vocabularies_match_contract(contract: dict) -> None:
    schemas = contract["components"]["schemas"]
    assert contract["info"]["version"] == "1.0.0"
    assert set(schemas["SourceRoleId"]["enum"]) == {item.value for item in SourceRole}
    assert set(schemas["LayoutPresetId"]["enum"]) == {item.value for item in LayoutPresetId}


def test_mic_room_is_rejected_as_a_publisher_binding() -> None:
    with pytest.raises(ValidationError):
        PublisherBinding(publisher_id=PublisherId.AUDIO, role_id=SourceRole.MIC_ROOM)


def test_bindable_roles_accepted() -> None:
    binding = PublisherBinding(publisher_id=PublisherId.USB, role_id=SourceRole.PRESENTATION)
    assert binding.role_id is SourceRole.PRESENTATION


class TestRatio:
    def test_both_present_ok(self) -> None:
        ratio = Ratio(ratio_a=50, ratio_b=50)
        assert ratio.ratio_a == 50

    def test_both_absent_ok(self) -> None:
        ratio = Ratio()
        assert ratio.ratio_a is None and ratio.ratio_b is None

    def test_only_a_present_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Ratio(ratio_a=50)

    def test_only_b_present_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Ratio(ratio_b=50)

    def test_non_positive_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Ratio(ratio_a=0, ratio_b=50)


class TestOutputPath:
    def test_relative_path_rejected(self) -> None:
        with pytest.raises(ValueError, match="absolute"):
            resolve_output_path(Path("relative/segment.ts"), Path("/media/eduscope/recordings"))

    def test_outside_root_rejected(self) -> None:
        with pytest.raises(ValueError, match="recordings root"):
            resolve_output_path(Path("/etc/passwd"), Path("/media/eduscope/recordings"))

    def test_inside_root_accepted(self) -> None:
        resolved = resolve_output_path(
            Path("/media/eduscope/recordings/2026/seg-001.ts"), Path("/media/eduscope/recordings")
        )
        assert resolved == Path("/media/eduscope/recordings/2026/seg-001.ts")


def test_service_cannot_bind_publicly() -> None:
    with pytest.raises(ValidationError, match="127.0.0.1"):
        Settings(bind_host="0.0.0.0", shared_bearer_token="x" * 32)
