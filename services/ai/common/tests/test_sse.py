from __future__ import annotations

import asyncio
import contextlib

from eduscope_ai_common.sse import SseBroker, SseEvent, format_sse


def test_format_sse_produces_id_event_data_blank_line() -> None:
    item = SseEvent(sequence=7, event="evt.stt.segment", payload={"text": "hi"})
    frame = format_sse(item)
    assert frame == 'id: 7\nevent: evt.stt.segment\ndata: {"text":"hi"}\n\n'


async def _start_subscriber(broker: SseBroker) -> tuple[asyncio.Task, list[str]]:
    received: list[str] = []

    async def consume() -> None:
        async for frame in broker.subscribe():
            received.append(frame)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)
    return task, received


async def test_publish_delivers_monotonic_sequenced_frames_in_order() -> None:
    broker = SseBroker()
    task, received = await _start_subscriber(broker)

    broker.publish("evt.a", {"n": 1})
    broker.publish("evt.b", {"n": 2})
    await asyncio.sleep(0.02)

    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    assert len(received) == 2
    assert received[0].startswith("id: 1\nevent: evt.a\n")
    assert received[1].startswith("id: 2\nevent: evt.b\n")


async def test_queue_full_closes_only_the_slow_subscriber() -> None:
    broker = SseBroker(max_queue=1)

    fast_received: list[str] = []
    slow_received: list[str] = []
    slow_blocked = asyncio.Event()

    async def fast_consumer() -> None:
        async for frame in broker.subscribe():
            fast_received.append(frame)

    async def slow_consumer() -> None:
        async for frame in broker.subscribe():
            slow_received.append(frame)
            await slow_blocked.wait()

    fast_task = asyncio.create_task(fast_consumer())
    slow_task = asyncio.create_task(slow_consumer())
    await asyncio.sleep(0.01)

    assert broker.subscriber_count() == 2

    broker.publish("evt.1", {"n": 1})
    await asyncio.sleep(0.01)
    # slow consumer has read evt.1 and is now parked in slow_blocked.wait();
    # its queue is empty again, so this fills it back up to capacity (1).
    broker.publish("evt.2", {"n": 2})
    await asyncio.sleep(0.01)

    assert broker.subscriber_count() == 2

    # slow consumer never drained evt.2, so its full queue now overflows
    # and only the slow subscriber is dropped.
    broker.publish("evt.3", {"n": 3})
    await asyncio.sleep(0.01)

    assert broker.subscriber_count() == 1

    fast_task.cancel()
    slow_blocked.set()
    with contextlib.suppress(asyncio.CancelledError):
        await fast_task
    await asyncio.wait_for(slow_task, timeout=1)

    assert len(slow_received) == 1
    assert len(fast_received) == 3


async def test_subscribe_unregisters_on_cancellation() -> None:
    broker = SseBroker()
    task, _received = await _start_subscriber(broker)

    assert broker.subscriber_count() == 1

    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    assert broker.subscriber_count() == 0
