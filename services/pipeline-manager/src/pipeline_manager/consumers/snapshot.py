from __future__ import annotations

from typing import Callable

from ..models import ConsumerState
from ..pipelines.platforms.base import PlatformProfile
from ..pipelines.snapshot import SnapshotRequest, build_snapshot
from .base import ConsumerController, ConsumerEvent, RestartClass


class SnapshotConsumer(ConsumerController):
    """AI slides (`snap_slides` successor) — RestartClass.AUX: restarts only
    while an AI subscription exists; otherwise the consumer just stops.
    """

    def __init__(
        self,
        consumer_id: str,
        *,
        platform: PlatformProfile,
        has_ai_subscription: Callable[[], bool],
        **kwargs,
    ) -> None:
        super().__init__(consumer_id, restart_class=RestartClass.AUX, **kwargs)
        self._platform = platform
        self._has_ai_subscription = has_ai_subscription

    async def start(self, request: SnapshotRequest) -> ConsumerEvent:
        spec = build_snapshot(request, self._platform)
        return await self.spawn(spec, priority="guaranteed")

    def on_unexpected_exit(self) -> ConsumerEvent | None:
        if not self._has_ai_subscription():
            self._ledger.release(self.consumer_id)
            self.state = ConsumerState.EXITED
            return None
        return super().on_unexpected_exit()
