from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.consumers.thumbnails import RoleNotPreviewable, ThumbnailController
from pipeline_manager.models import ConsumerState, SourceRole
from pipeline_manager.pipelines.thumbnails import ThumbnailOffer
from pipeline_manager.supervisor.ledger import EncodeLedger

from .conftest import FakeSupervisor, SignalSpy

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "events" / "thumbnail-signaling.json"


@dataclass
class RecordingEvents:
    published: list = field(default_factory=list)

    async def publish(self, kind: str, data: dict):
        self.published.append((kind, data))
        return None


def _offer(negotiation_id: str = "n1", role_id: SourceRole = SourceRole.PRESENTATION) -> ThumbnailOffer:
    return ThumbnailOffer(type="offer", negotiation_id=negotiation_id, role_id=role_id, sdp="v=0...")


def _controller(is_role_online_and_bound=lambda role: True, events=None) -> ThumbnailController:
    return ThumbnailController(
        supervisor=FakeSupervisor(),
        ledger=EncodeLedger(),
        is_role_online_and_bound=is_role_online_and_bound,
        send_signal=SignalSpy(),
        events=events,
    )


def test_fixture_matches_events_md_section_3_shape() -> None:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    by_type = {row["type"]: row for row in rows}
    assert set(by_type["offer"].keys()) >= {"negotiationId", "roleId", "sdp"}
    assert set(by_type["answer"].keys()) >= {"negotiationId", "sdp"}
    assert set(by_type["ice"].keys()) >= {"negotiationId", "candidate", "sdpMid", "sdpMLineIndex"}
    assert set(by_type["error"].keys()) >= {"negotiationId", "code", "message"}
    assert by_type["error"]["code"] == "source-offline"
    assert set(by_type["close"].keys()) >= {"negotiationId"}
    # every row shares one negotiationId — one negotiation per open preview
    assert len({row["negotiationId"] for row in rows}) == 1


@pytest.mark.asyncio
async def test_offer_accepted_only_for_an_online_bound_video_role() -> None:
    controller = _controller(is_role_online_and_bound=lambda role: False)
    with pytest.raises(RoleNotPreviewable):
        await controller.offer(_offer())


@pytest.mark.asyncio
async def test_offer_accepted_for_online_bound_role() -> None:
    controller = _controller()
    event = await controller.offer(_offer())
    assert event.state is ConsumerState.RUNNING
    assert controller.negotiation_count() == 1


@pytest.mark.asyncio
async def test_consumer_id_preserves_negotiation_id() -> None:
    controller = _controller()
    event = await controller.offer(_offer(negotiation_id="n42"))
    assert "n42" in event.consumer_id


@pytest.mark.asyncio
async def test_second_offer_closes_first() -> None:
    controller = _controller()
    first = await controller.offer(_offer(negotiation_id="n1"))
    second = await controller.offer(_offer(negotiation_id="n1"))
    assert controller.negotiation_count() == 1  # first was closed, second replaced it
    assert first.pgid != second.pgid


@pytest.mark.asyncio
async def test_close_is_idempotent() -> None:
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1"))
    first_close = await controller.close("n1")
    second_close = await controller.close("n1")
    assert first_close is not None
    assert second_close is None  # already closed, no-op


@pytest.mark.asyncio
async def test_closing_unknown_negotiation_is_a_no_op() -> None:
    controller = _controller()
    result = await controller.close("never-existed")
    assert result is None


@pytest.mark.asyncio
async def test_closing_last_negotiation_releases_provisional_slot() -> None:
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1"))
    assert controller.negotiation_count() == 1

    await controller.close("n1")

    assert controller.negotiation_count() == 0


@pytest.mark.asyncio
async def test_offer_writes_the_offer_as_the_first_stdin_control_line() -> None:
    """A-REV-008: the SDP offer arrives at the worker over stdin — never
    baked into argv (it's per-negotiation and can be resent on a second
    offer)."""
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1"))
    negotiation = controller.negotiations["n1"]
    written = negotiation.process.popen.stdin.written
    assert len(written) == 1
    payload = json.loads(written[0])
    assert payload["type"] == "offer"
    assert payload["negotiation_id"] == "n1"
    assert payload["sdp"] == "v=0..."


@pytest.mark.asyncio
async def test_send_ice_forwards_to_the_negotiations_worker_stdin() -> None:
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1"))
    negotiation = controller.negotiations["n1"]

    forwarded = controller.send_ice(
        "n1", candidate="candidate:1 1 UDP 2 10.0.0.1 5000 typ host", sdp_mid="0", sdp_mline_index=0
    )

    assert forwarded is True
    written = negotiation.process.popen.stdin.written
    assert len(written) == 2  # offer, then ice
    payload = json.loads(written[1])
    assert payload["type"] == "ice"
    assert payload["candidate"].startswith("candidate:1")


@pytest.mark.asyncio
async def test_send_ice_on_unknown_negotiation_is_a_silent_no_op() -> None:
    controller = _controller()
    assert controller.send_ice("never-existed", candidate="x", sdp_mid=None, sdp_mline_index=None) is False


@pytest.mark.asyncio
async def test_worker_answer_line_is_republished_as_a_camelcase_event() -> None:
    """The parent pump translates the worker's snake_case wire message into
    the camelCase `evt.pm.thumbnails.signal` contract shape."""
    events = RecordingEvents()
    controller = _controller(events=events)
    await controller.offer(_offer(negotiation_id="n1"))
    negotiation = controller.negotiations["n1"]

    negotiation.process.raw_lines.append(
        json.dumps({"type": "answer", "negotiation_id": "n1", "sdp": "v=0...answer"})
    )
    await asyncio.sleep(0.2)  # let the pump task's poll loop observe it

    assert ("evt.pm.thumbnails.signal", {"type": "answer", "negotiationId": "n1", "sdp": "v=0...answer"}) in events.published
    controller._pump_tasks["n1"].cancel()


@pytest.mark.asyncio
async def test_worker_ice_line_is_republished_with_camelcase_fields() -> None:
    events = RecordingEvents()
    controller = _controller(events=events)
    await controller.offer(_offer(negotiation_id="n1"))
    negotiation = controller.negotiations["n1"]

    negotiation.process.raw_lines.append(
        json.dumps(
            {
                "type": "ice",
                "negotiation_id": "n1",
                "candidate": "candidate:1 1 UDP 2 10.0.0.1 5000 typ host",
                "sdp_mid": "0",
                "sdp_mline_index": 0,
            }
        )
    )
    await asyncio.sleep(0.2)

    kinds = [kind for kind, _ in events.published]
    assert "evt.pm.thumbnails.signal" in kinds
    payload = next(data for kind, data in events.published if kind == "evt.pm.thumbnails.signal")
    assert payload == {
        "type": "ice",
        "negotiationId": "n1",
        "candidate": "candidate:1 1 UDP 2 10.0.0.1 5000 typ host",
        "sdpMid": "0",
        "sdpMLineIndex": 0,
    }
    controller._pump_tasks["n1"].cancel()


@pytest.mark.asyncio
async def test_non_signaling_stdout_lines_are_ignored_by_the_pump() -> None:
    """A bare `PLAYING`/`Got EOS` bus-status line (already handled by the
    generic supervisor observation queue) is not a signaling frame — the
    pump must not choke on or republish it."""
    events = RecordingEvents()
    controller = _controller(events=events)
    await controller.offer(_offer(negotiation_id="n1"))
    negotiation = controller.negotiations["n1"]

    negotiation.process.raw_lines.append("PLAYING")
    negotiation.process.raw_lines.append("not json at all")
    await asyncio.sleep(0.2)

    assert events.published == []
    controller._pump_tasks["n1"].cancel()


@pytest.mark.asyncio
async def test_close_cancels_the_output_pump_task() -> None:
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1"))
    pump = controller._pump_tasks["n1"]

    await controller.close("n1")
    await asyncio.sleep(0)

    assert pump.cancelled() or pump.done()
    assert "n1" not in controller._pump_tasks


@pytest.mark.asyncio
async def test_source_loss_reports_negotiations_bound_to_that_role() -> None:
    # Only one provisional ledger slot exists system-wide (A-07 §4.1's
    # unmeasured-risk note, B-T1) — one active negotiation is the realistic case.
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1", role_id=SourceRole.LECTURER_CAM))

    assert controller.negotiations_for_role(SourceRole.LECTURER_CAM) == ("n1",)
    assert controller.negotiations_for_role(SourceRole.STUDENTS_CAM) == ()
