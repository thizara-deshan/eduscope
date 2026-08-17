from __future__ import annotations

from typing import Callable

from ..models import ConsumerState
from ..pipelines.platforms.base import PlatformProfile
from ..pipelines.projector import ProjectorMode, QuestionOverlay, build_projector, encode_control_message
from .base import ConsumerController, ConsumerEvent, RestartClass


class ProjectorConsumer(ConsumerController):
    """HDMI #1 — RestartClass.DISPLAY: restarts only while the
    laptop-present-or-question precondition holds; otherwise goes idle
    (no restart attempted). Mode switches never spawn a second child —
    `set_mode` only ever writes a control message to the running worker.
    """

    def __init__(
        self,
        consumer_id: str,
        *,
        platform: PlatformProfile,
        precondition_holds: Callable[[], bool],
        **kwargs,
    ) -> None:
        super().__init__(consumer_id, restart_class=RestartClass.DISPLAY, **kwargs)
        self._platform = platform
        self._precondition_holds = precondition_holds
        self.mode = ProjectorMode.PASSTHROUGH

    async def start(self) -> ConsumerEvent:
        spec = build_projector(self._platform)
        return await self.spawn(spec, priority="guaranteed")

    def set_mode(self, mode: ProjectorMode, payload: QuestionOverlay | None = None) -> bytes:
        """No restart, no second child — same pgid before and after."""
        if self.process is None or self.process.popen.stdin is None:
            raise RuntimeError("projector worker is not running")
        message = encode_control_message(mode, payload)
        self.process.popen.stdin.write(message)
        self.process.popen.stdin.flush()
        self.mode = mode
        return message

    def on_unexpected_exit(self) -> ConsumerEvent | None:
        """DISPLAY class: restart only while the precondition holds; otherwise
        go idle without consuming a restart attempt."""
        if not self._precondition_holds():
            self._ledger.release(self.consumer_id)
            self.state = ConsumerState.EXITED
            return None
        return super().on_unexpected_exit()
