from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from ..models import ConsumerState
from ..overlays import render_question_card
from ..pipelines.platforms.base import PlatformProfile
from ..pipelines.projector import ProjectorMode, QuestionOverlay, build_projector, encode_control_message
from .base import ConsumerController, ConsumerEvent, RestartClass


class ProjectorConsumer(ConsumerController):
    """HDMI #1 — RestartClass.DISPLAY: restarts only while the
    laptop-present-or-question precondition holds; otherwise goes idle
    (no restart attempted). Mode switches never spawn a second child —
    `set_mode` only ever renders a card and writes a control message to the
    running worker.
    """

    # Keep at most this many rendered cards on disk; older ones are deleted as
    # each new question supersedes them (bounded cleanup owned by the consumer).
    _CARD_HISTORY = 2

    def __init__(
        self,
        consumer_id: str,
        *,
        platform: PlatformProfile,
        precondition_holds: Callable[[], bool],
        runtime_dir: str | os.PathLike[str] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(consumer_id, restart_class=RestartClass.DISPLAY, **kwargs)
        self._platform = platform
        self._precondition_holds = precondition_holds
        self._runtime_dir = runtime_dir
        self.mode = ProjectorMode.PASSTHROUGH
        self._rendered_cards: list[str] = []

    async def start(self) -> ConsumerEvent:
        spec = build_projector(self._platform)
        return await self.spawn(spec, priority="guaranteed")

    def set_mode(self, mode: ProjectorMode, payload: QuestionOverlay | None = None) -> bytes:
        """No restart, no second child — same pgid before and after. In
        question mode the full 1920×1080 card is rendered server-side and the
        worker receives only its PNG path."""
        if self.process is None or self.process.popen.stdin is None:
            raise RuntimeError("projector worker is not running")

        card_path: str | None = None
        if mode is ProjectorMode.QUESTION:
            if payload is None:
                raise ValueError("question mode requires a QuestionOverlay payload")
            card_path = render_question_card(payload, self._render_dir())
            self._track_card(card_path)

        message = encode_control_message(mode, card_path)
        stdin = self.process.popen.stdin
        # Popen streams are opened text=True (line-based bus parsing needs
        # that for stdout/stderr); `.buffer` reaches the underlying binary
        # writer so this length-delimited frame goes out byte-exact.
        writer = getattr(stdin, "buffer", stdin)
        writer.write(message)
        writer.flush()
        self.mode = mode
        return message

    def _render_dir(self) -> str | os.PathLike[str]:
        if self._runtime_dir is not None:
            return self._runtime_dir
        # Hermetic fallback for unit tests that never set a runtime dir.
        return Path(os.environ.get("TMPDIR", "/tmp")) / "eduscope-projector"

    def _track_card(self, card_path: str) -> None:
        """Record the new card and delete any superseded ones beyond the small
        retained history (a re-project can reference the immediately-previous
        card; anything older is dead)."""
        self._rendered_cards.append(card_path)
        while len(self._rendered_cards) > self._CARD_HISTORY:
            stale = self._rendered_cards.pop(0)
            if stale == card_path:
                continue
            try:
                os.remove(stale)
            except FileNotFoundError:
                pass

    def on_unexpected_exit(self) -> ConsumerEvent | None:
        """DISPLAY class: restart only while the precondition holds; otherwise
        go idle without consuming a restart attempt."""
        if not self._precondition_holds():
            self._ledger.release(self.consumer_id)
            self.state = ConsumerState.EXITED
            return None
        return super().on_unexpected_exit()
