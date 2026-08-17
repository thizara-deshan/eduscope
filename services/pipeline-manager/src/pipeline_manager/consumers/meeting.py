from __future__ import annotations

from typing import Callable

from ..models import SourceRole
from ..pipelines.meeting import MeetingRequest, build_meeting
from ..pipelines.platforms.base import PlatformProfile
from .base import ConsumerController, ConsumerEvent, PublisherNotRunning, RestartClass


class MeetingConsumer(ConsumerController):
    """Live Meeting channel (CH-04) — RestartClass.CHANNEL, display path, no
    encode. `spec.placement` (HDMI #2, fullscreen) is exposed for the caller
    to apply via the platform plug post-PLAYING; placement is not pipeline text.
    """

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

    async def start(self, request: MeetingRequest) -> ConsumerEvent:
        spec = build_meeting(request, self._platform)
        for role in spec.required_roles:
            if not self._is_publisher_running(role):
                raise PublisherNotRunning(f"required publisher for {role.value} is not running")
        event = await self.spawn(spec, priority="guaranteed")
        return event

    @property
    def placement(self):
        return self.spec.placement if self.spec is not None else None
