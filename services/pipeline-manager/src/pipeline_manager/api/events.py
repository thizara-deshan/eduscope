from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class Event:
    sequence: int
    kind: str
    data: dict


RESYNC_EVENT_KIND = "evt.pm.resync-required"


def format_sse(event: Event) -> str:
    payload = json.dumps(event.data, separators=(",", ":"))
    return f"id: {event.sequence}\nevent: {event.kind}\ndata: {payload}\n\n"


class EventBroker:
    """One sequenced, replayable internal event stream. Sequence increments
    under one asyncio lock; no event is emitted before the state-snapshot
    mutation it describes (callers publish only after mutating state).
    A bounded deque backs replay; each subscriber gets its own bounded
    queue — a slow subscriber's overflow closes only that subscriber.
    """

    def __init__(
        self,
        *,
        replay_size: int = 512,
        subscriber_queue_size: int = 100,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._history: deque[Event] = deque(maxlen=replay_size)
        self._subscriber_queue_size = subscriber_queue_size
        self._sequence = 0
        self._lock = asyncio.Lock()
        self._subscribers: dict[int, asyncio.Queue[Event]] = {}
        self._closed_subscribers: set[int] = set()
        self._next_subscriber_id = 0
        self._clock = clock

    @property
    def sequence(self) -> int:
        return self._sequence

    async def publish(self, kind: str, data: dict) -> Event:
        async with self._lock:
            self._sequence += 1
            event = Event(sequence=self._sequence, kind=kind, data=data)
            self._history.append(event)
            for sid, queue in list(self._subscribers.items()):
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    del self._subscribers[sid]
                    self._closed_subscribers.add(sid)
        return event

    def subscribe(self) -> tuple[int, "asyncio.Queue[Event]"]:
        sid = self._next_subscriber_id
        self._next_subscriber_id += 1
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=self._subscriber_queue_size)
        self._subscribers[sid] = queue
        return sid, queue

    def unsubscribe(self, sid: int) -> None:
        self._subscribers.pop(sid, None)
        self._closed_subscribers.discard(sid)

    def is_closed(self, sid: int) -> bool:
        return sid in self._closed_subscribers

    def replay_since(self, last_event_id: int) -> list[Event] | None:
        """Events strictly after `last_event_id`. Returns None when the
        requested id is older than what the buffer retains — the caller
        must emit `evt.pm.resync-required` and fall back to `/status`.
        """
        if last_event_id >= self._sequence:
            return []
        if not self._history:
            return None if last_event_id > 0 else []
        oldest_retained = self._history[0].sequence
        if last_event_id < oldest_retained - 1:
            return None
        return [event for event in self._history if event.sequence > last_event_id]
