from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.hardware.helper_client import HelperClient
from pipeline_manager.hardware.led import LedController, led_mode_for_recording_state


@dataclass
class SpyHelper:
    calls: list = field(default_factory=list)

    async def set_led(self, mode):
        self.calls.append(mode)
        return None


class TestLedModeDerivation:
    def test_recording_maps_to_blink(self) -> None:
        assert led_mode_for_recording_state("recording") == "blink"

    @pytest.mark.parametrize(
        "state", ["idle", "starting", "paused", "stopping", "finalizing", "completed", "error"]
    )
    def test_every_other_state_maps_to_off(self, state: str) -> None:
        assert led_mode_for_recording_state(state) == "off"


@pytest.mark.asyncio
async def test_applies_derived_mode_via_helper() -> None:
    helper = SpyHelper()
    controller = LedController(helper)
    await controller.apply_recording_state("recording")
    assert helper.calls == ["blink"]


@pytest.mark.asyncio
async def test_absent_led_is_a_logged_no_op() -> None:
    helper = SpyHelper()
    controller = LedController(helper, present=False)
    result = await controller.apply_recording_state("recording")
    assert result is None
    assert helper.calls == []  # never touched the helper at all


@pytest.mark.asyncio
async def test_controller_does_not_own_recording_state() -> None:
    """The LED is purely derived — LedController must not expose a setter for
    recording/session state, only a read of the mode it applies."""
    helper = SpyHelper()
    controller = LedController(helper)
    assert not hasattr(controller, "recording_state")
    assert not hasattr(controller, "set_recording_state")
