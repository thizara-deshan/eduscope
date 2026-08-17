from __future__ import annotations

import pytest

from pipeline_manager.consumers.base import RestartClass
from pipeline_manager.consumers.snapshot import SnapshotConsumer
from pipeline_manager.models import ConsumerState
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.snapshot import SnapshotRequest
from pipeline_manager.supervisor.ledger import EncodeLedger

from .conftest import FakeConfirmer, FakeSupervisor


def _consumer(has_ai_subscription=lambda: True):
    consumer = SnapshotConsumer(
        "snapshot:1",
        platform=RK3588Profile(),
        has_ai_subscription=has_ai_subscription,
        supervisor=FakeSupervisor(),
        ledger=EncodeLedger(),
        confirmer=FakeConfirmer(),
    )
    return consumer


def test_restart_class_is_aux() -> None:
    assert _consumer().restart_class is RestartClass.AUX


@pytest.mark.asyncio
async def test_starts_with_a_valid_interval_and_output_path() -> None:
    consumer = _consumer()
    event = await consumer.start(SnapshotRequest(interval_sec=5, output_path="/media/eduscope/slides/out.png"))
    assert event.state is ConsumerState.RUNNING


def test_restarts_while_ai_subscription_exists() -> None:
    consumer = _consumer(has_ai_subscription=lambda: True)
    event = consumer.on_unexpected_exit()
    assert event is not None
    assert event.state is ConsumerState.EXITED


def test_stops_without_restart_when_no_ai_subscription() -> None:
    consumer = _consumer(has_ai_subscription=lambda: False)
    event = consumer.on_unexpected_exit()
    assert event is None
    assert consumer.restart_budget.exhausted is False
