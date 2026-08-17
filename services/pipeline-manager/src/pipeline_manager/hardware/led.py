from __future__ import annotations

from typing import Literal

from .helper_client import HelperClient, HelperResponse

RecordingWireState = Literal[
    "idle", "starting", "recording", "paused", "stopping", "finalizing", "completed", "error"
]

_BLINK_STATES: frozenset[str] = frozenset({"recording"})


def led_mode_for_recording_state(state: RecordingWireState) -> Literal["on", "off", "blink"]:
    """The LED is a pure function of recording.state (B-05 -> PF-14) — core-api
    is the single writer of that state; the manager only derives the mode."""
    return "blink" if state in _BLINK_STATES else "off"


class LedController:
    """GPIO presence is fact-check H-4; if absent, applying is a logged no-op."""

    def __init__(self, helper: HelperClient, *, present: bool = True) -> None:
        self._helper = helper
        self.present = present

    async def apply_recording_state(self, state: RecordingWireState) -> HelperResponse | None:
        if not self.present:
            return None
        mode = led_mode_for_recording_state(state)
        return await self._helper.set_led(mode)
