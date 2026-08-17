from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline_manager.consumers.thumbnails import RoleNotPreviewable, ThumbnailController
from pipeline_manager.models import ConsumerState, SourceRole
from pipeline_manager.pipelines.thumbnails import ThumbnailOffer
from pipeline_manager.supervisor.ledger import EncodeLedger

from .conftest import FakeSupervisor, SignalSpy

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "events" / "thumbnail-signaling.json"


def _offer(negotiation_id: str = "n1", role_id: SourceRole = SourceRole.PRESENTATION) -> ThumbnailOffer:
    return ThumbnailOffer(type="offer", negotiation_id=negotiation_id, role_id=role_id, sdp="v=0...")


def _controller(is_role_online_and_bound=lambda role: True) -> ThumbnailController:
    return ThumbnailController(
        supervisor=FakeSupervisor(),
        ledger=EncodeLedger(),
        is_role_online_and_bound=is_role_online_and_bound,
        send_signal=SignalSpy(),
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
async def test_source_loss_reports_negotiations_bound_to_that_role() -> None:
    # Only one provisional ledger slot exists system-wide (A-07 §4.1's
    # unmeasured-risk note, B-T1) — one active negotiation is the realistic case.
    controller = _controller()
    await controller.offer(_offer(negotiation_id="n1", role_id=SourceRole.LECTURER_CAM))

    assert controller.negotiations_for_role(SourceRole.LECTURER_CAM) == ("n1",)
    assert controller.negotiations_for_role(SourceRole.STUDENTS_CAM) == ()
