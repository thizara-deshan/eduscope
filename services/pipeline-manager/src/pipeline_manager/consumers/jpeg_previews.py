from __future__ import annotations

from pathlib import Path

from ..pipelines.jpeg_previews import build_jpeg_previews
from ..pipelines.platforms.base import PlatformProfile
from .base import ConsumerController, ConsumerEvent, RestartClass


class JpegPreviewConsumer(ConsumerController):
    def __init__(self, *, platform: PlatformProfile, output_dir: Path, **kwargs) -> None:
        super().__init__("jpeg-previews:main", restart_class=RestartClass.AUX, **kwargs)
        self._platform = platform
        self.output_dir = output_dir

    async def start(self) -> ConsumerEvent:
        if self.process is not None:
            return ConsumerEvent(self.consumer_id, "running", self.state, pgid=self.pgid)
        return await self.spawn(build_jpeg_previews(self.output_dir, self._platform), priority="guaranteed")
