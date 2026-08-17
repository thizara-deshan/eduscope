from __future__ import annotations

import asyncio

import pytest

from pipeline_manager.api.events import EventBroker, format_sse


class TestEventBrokerCore:
    @pytest.mark.asyncio
    async def test_sequence_increments_per_publish(self) -> None:
        broker = EventBroker()
        first = await broker.publish("evt.pm.consumer.running", {"a": 1})
        second = await broker.publish("evt.pm.consumer.running", {"a": 2})
        assert first.sequence == 1
        assert second.sequence == 2

    @pytest.mark.asyncio
    async def test_subscriber_receives_published_events(self) -> None:
        broker = EventBroker()
        sid, queue = broker.subscribe()
        await broker.publish("evt.pm.consumer.running", {"x": 1})
        event = await asyncio.wait_for(queue.get(), timeout=1)
        assert event.sequence == 1
        broker.unsubscribe(sid)

    @pytest.mark.asyncio
    async def test_reconnect_with_last_event_id_receives_only_newer_events_once(self) -> None:
        broker = EventBroker()
        await broker.publish("k", {"n": 1})
        await broker.publish("k", {"n": 2})
        await broker.publish("k", {"n": 3})

        replay = broker.replay_since(1)

        assert [event.sequence for event in replay] == [2, 3]

    @pytest.mark.asyncio
    async def test_replay_too_old_returns_none_for_resync(self) -> None:
        broker = EventBroker(replay_size=2)
        for i in range(5):
            await broker.publish("k", {"n": i})

        # buffer only retains the last 2; asking for something long gone -> None
        replay = broker.replay_since(0)

        assert replay is None

    @pytest.mark.asyncio
    async def test_up_to_date_last_event_id_returns_empty_list_not_none(self) -> None:
        broker = EventBroker()
        await broker.publish("k", {"n": 1})
        replay = broker.replay_since(1)
        assert replay == []


class TestSlowSubscriberIsolation:
    @pytest.mark.asyncio
    async def test_overflowing_one_subscriber_does_not_affect_another(self) -> None:
        broker = EventBroker(subscriber_queue_size=2)
        slow_sid, slow_queue = broker.subscribe()
        fast_sid, fast_queue = broker.subscribe()

        for i in range(5):
            await broker.publish("k", {"n": i})
            await fast_queue.get()  # fast subscriber keeps draining

        assert broker.is_closed(slow_sid) is True
        assert broker.is_closed(fast_sid) is False


class TestSseFormatting:
    def test_format_uses_id_event_data_lines(self) -> None:
        from pipeline_manager.api.events import Event

        text = format_sse(Event(sequence=7, kind="evt.pm.consumer.running", data={"a": 1}))
        lines = text.splitlines()
        assert lines[0] == "id: 7"
        assert lines[1] == "event: evt.pm.consumer.running"
        assert lines[2] == 'data: {"a":1}'  # compact JSON, no spaces


@pytest.mark.asyncio
async def test_sse_route_streams_events(app) -> None:
    """The route never terminates its body on its own (it's a live stream),
    so httpx's ASGITransport — which buffers a full app-call round trip — can't
    be used to exercise it end-to-end. Call the route function directly and
    read a bounded number of chunks off its `StreamingResponse.body_iterator`.
    """
    from starlette.requests import Request

    from pipeline_manager.api.routes import get_events

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/events",
        "headers": [],
        "app": app,
        "query_string": b"",
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    request = Request(scope, receive=receive)
    response = await get_events(request)

    assert response.media_type == "text/event-stream"

    # The generator only subscribes once iterated — start iterating, give it a
    # moment to reach subscribe(), then publish so the live subscriber sees it.
    anext_task = asyncio.ensure_future(response.body_iterator.__anext__())
    await asyncio.sleep(0.05)
    await app.state.events.publish("evt.pm.consumer.running", {"x": 1})
    chunk = await asyncio.wait_for(anext_task, timeout=2)

    assert "evt.pm.consumer.running" in chunk
    assert '"x":1' in chunk
