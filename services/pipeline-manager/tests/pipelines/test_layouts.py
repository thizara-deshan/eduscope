from __future__ import annotations

import itertools
import json
from pathlib import Path

import pytest

from pipeline_manager.models import Channel, LayoutPresetId
from pipeline_manager.pipelines.layouts import (
    PresetChannelMismatch,
    get_layout,
    ratio_geometry,
)

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "layouts" / "geometry.json"

ALLOWED = {
    Channel.LOCAL: {"fifty-fifty", "side-by-side", "cam-1", "cam-2", "separate-files"},
    Channel.MEETING: {"cams-fifty-fifty", "cam-1", "cam-2"},
    Channel.STREAMING: {"fifty-fifty", "side-by-side", "cam-1", "cam-2", "pc-only"},
}


@pytest.mark.parametrize("channel,preset", itertools.product(Channel, LayoutPresetId))
def test_exact_v1_channel_matrix(channel: Channel, preset: LayoutPresetId) -> None:
    if preset.value in ALLOWED[channel]:
        assert get_layout(preset, channel, 50, 50).id is preset
    else:
        with pytest.raises(PresetChannelMismatch):
            get_layout(preset, channel, 50, 50)


def test_allowed_pair_count_is_thirteen() -> None:
    assert sum(len(presets) for presets in ALLOWED.values()) == 13


class TestRatioGeometry:
    def test_fifty_fifty(self) -> None:
        geometry = ratio_geometry(50, 50)
        assert (geometry.x0, geometry.y0, geometry.w0, geometry.h0) == (0, 270, 960, 540)
        assert (geometry.x1, geometry.y1, geometry.w1, geometry.h1) == (960, 270, 960, 540)

    def test_seventy_thirty(self) -> None:
        geometry = ratio_geometry(70, 30)
        assert (geometry.x0, geometry.y0, geometry.w0, geometry.h0) == (0, 162, 1344, 756)
        assert (geometry.x1, geometry.y1, geometry.w1, geometry.h1) == (1344, 378, 576, 324)

    @pytest.mark.parametrize("ratio_a,ratio_b", [(50, 50), (70, 30), (2, 1), (99, 1)])
    def test_all_dimensions_even(self, ratio_a: int, ratio_b: int) -> None:
        geometry = ratio_geometry(ratio_a, ratio_b)
        for value in (geometry.x0, geometry.y0, geometry.w0, geometry.h0, geometry.x1, geometry.y1, geometry.w1, geometry.h1):
            assert value % 2 == 0

    @pytest.mark.parametrize("ratio_a,ratio_b", [(50, 50), (70, 30), (2, 1)])
    def test_tiles_are_16_by_9(self, ratio_a: int, ratio_b: int) -> None:
        geometry = ratio_geometry(ratio_a, ratio_b)
        assert geometry.w0 * 9 == geometry.h0 * 16
        assert geometry.w1 * 9 == geometry.h1 * 16

    @pytest.mark.parametrize("ratio_a,ratio_b", [(50, 50), (70, 30), (2, 1)])
    def test_tiles_within_canvas_bounds(self, ratio_a: int, ratio_b: int) -> None:
        geometry = ratio_geometry(ratio_a, ratio_b)
        assert geometry.x0 + geometry.w0 <= 1920
        assert geometry.y0 + geometry.h0 <= 1080
        assert geometry.x1 + geometry.w1 <= 1920
        assert geometry.y1 + geometry.h1 <= 1080

    @pytest.mark.parametrize("ratio_a,ratio_b", [(50, 50), (70, 30), (2, 1)])
    def test_tiles_do_not_overlap(self, ratio_a: int, ratio_b: int) -> None:
        geometry = ratio_geometry(ratio_a, ratio_b)
        # Tile 0 occupies [x0, x0+w0); tile 1 starts exactly where it ends.
        assert geometry.x0 + geometry.w0 <= geometry.x1

    def test_non_positive_ratio_rejected(self) -> None:
        with pytest.raises(ValueError):
            ratio_geometry(0, 50)

    def test_matches_golden_fixture(self) -> None:
        rows = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        for row in rows:
            geometry = ratio_geometry(row["ratioA"], row["ratioB"])
            expected = row["geometry"]
            assert geometry.x0 == expected["x0"]
            assert geometry.y0 == expected["y0"]
            assert geometry.w0 == expected["w0"]
            assert geometry.h0 == expected["h0"]
            assert geometry.x1 == expected["x1"]
            assert geometry.y1 == expected["y1"]
            assert geometry.w1 == expected["w1"]
            assert geometry.h1 == expected["h1"]


class TestGetLayoutGeometry:
    def test_fifty_fifty_default_matches_oracle(self) -> None:
        layout = get_layout(LayoutPresetId.FIFTY_FIFTY, Channel.LOCAL, 50, 50)
        first, second = layout.tiles
        assert (first.x, first.y, first.w, first.h) == (0, 270, 960, 540)
        assert (second.x, second.y, second.w, second.h) == (960, 270, 960, 540)

    def test_side_by_side_default_ratio_is_two_to_one(self) -> None:
        layout = get_layout(LayoutPresetId.SIDE_BY_SIDE, Channel.LOCAL, None, None)
        first, second = layout.tiles
        assert (first.x, first.y, first.w, first.h) == (0, 180, 1280, 720)
        assert (second.x, second.y, second.w, second.h) == (1280, 360, 640, 360)

    def test_single_tile_preset_ignores_ratio(self) -> None:
        layout = get_layout(LayoutPresetId.CAM_1, Channel.LOCAL, 50, 50)
        assert len(layout.tiles) == 1
