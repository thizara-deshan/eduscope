from __future__ import annotations

import asyncio
import itertools
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

DEFAULT_MAX_QUEUE = 64


@dataclass(frozen=True)
class SseEvent:
    sequence: int
    event: str
    payload: dict[str, Any]


def format_sse(item: SseEvent) -> str:
    data = json.dumps(item.payload, separators=(",", ":"), ensure_ascii=False)
    return f"id: {item.sequence}\nevent: {item.event}\ndata: {data}\n\n"


class SseBroker:
    """Bounded, per-subscriber SSE fan-out. No replay: a reconnecting
    subscriber re-reads /status rather than replaying missed events."""

    def __init__(self, *, max_queue: int = DEFAULT_MAX_QUEUE) -> None:
        self._max_queue = max_queue
        self._sequence = itertools.count(1)
        self._subscriber_ids = itertools.count(1)
        self._subscribers: dict[int, asyncio.Queue[SseEvent | None]] = {}

    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, event: str, payload: BaseModel | dict[str, Any]) -> int:
        sequence = next(self._sequence)
        payload_dict = (
            payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
        )
        item = SseEvent(sequence=sequence, event=event, payload=payload_dict)
        for subscriber_id, queue in list(self._subscribers.items()):
            try:
                queue.put_nowait(item)
            except asyncio.QueueFull:
                self._drop_subscriber(subscriber_id, queue)
        return sequence

    def _drop_subscriber(
        self, subscriber_id: int, queue: asyncio.Queue[SseEvent | None]
    ) -> None:
        self._subscribers.pop(subscriber_id, None)
        while True:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        queue.put_nowait(None)

    async def subscribe(self) -> AsyncIterator[str]:
        subscriber_id = next(self._subscriber_ids)
        queue: asyncio.Queue[SseEvent | None] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers[subscriber_id] = queue
        try:
            while True:
                item = await queue.get()
                if item is None:
                    return
                yield format_sse(item)
        finally:
            self._subscribers.pop(subscriber_id, None)
