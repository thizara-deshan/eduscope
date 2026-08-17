from __future__ import annotations

from typing import Callable

from ..models import SourceRole
from ..pipelines.live import LiveRequest, build_live
from ..pipelines.platforms.base import PlatformProfile
from .base import ConsumerController, ConsumerEvent, PublisherNotRunning, RestartClass


class LiveConsumer(ConsumerController):
    """Streaming channel (CH-01/02) — RestartClass.CHANNEL: restart 3x with
    backoff; the record consumer is never touched (INV-CC-2)."""

    def __init__(
        self,
        consumer_id: str,
        *,
        platform: PlatformProfile,
        is_publisher_running: Callable[[SourceRole], bool],
        **kwargs,
    ) -> None:
        super().__init__(consumer_id, restart_class=RestartClass.CHANNEL, **kwargs)
        self._platform = platform
        self._is_publisher_running = is_publisher_running

    async def start(self, request: LiveRequest) -> ConsumerEvent:
        spec = build_live(request, self._platform)
        for role in spec.required_roles:
            if not self._is_publisher_running(role):
                raise PublisherNotRunning(f"required publisher for {role.value} is not running")
        return await self.spawn(spec, priority="guaranteed")
