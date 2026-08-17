from __future__ import annotations

import pytest

from pipeline_manager.consumers.base import RestartClass
from pipeline_manager.consumers.projector import ProjectorConsumer
from pipeline_manager.models import ConsumerState
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.projector import ProjectorMode, QuestionOverlay
from pipeline_manager.supervisor.ledger import EncodeLedger

from .conftest import FakeConfirmer, FakeSupervisor


def _consumer(precondition_holds=lambda: True):
    supervisor = FakeSupervisor()
    consumer = ProjectorConsumer(
        "projector:1",
        platform=RK3588Profile(),
        precondition_holds=precondition_holds,
        supervisor=supervisor,
        ledger=EncodeLedger(),
        confirmer=FakeConfirmer(),
    )
    return consumer, supervisor


def test_restart_class_is_display() -> None:
    consumer, _ = _consumer()
    assert consumer.restart_class is RestartClass.DISPLAY


@pytest.mark.asyncio
async def test_mode_switch_does_not_spawn_a_second_child() -> None:
    consumer, supervisor = _consumer()
    await consumer.start()
    assert len(supervisor.calls) == 1

    consumer.set_mode(
        ProjectorMode.QUESTION,
        QuestionOverlay(question_text="Q?", options=["a", "b"], join_qr_png_path="/qr.png"),
    )
    consumer.set_mode(ProjectorMode.PASSTHROUGH)

    assert len(supervisor.calls) == 1  # still just the one worker


@pytest.mark.asyncio
async def test_set_mode_writes_to_worker_stdin() -> None:
    consumer, _ = _consumer()
    await consumer.start()

    consumer.set_mode(ProjectorMode.PASSTHROUGH)

    written = consumer.process.popen.stdin.written
    assert len(written) == 1
    assert b"passthrough" in written[0]


def test_restarts_while_precondition_holds() -> None:
    consumer, _ = _consumer(precondition_holds=lambda: True)
    event = consumer.on_unexpected_exit()
    assert event is not None
    assert event.state is ConsumerState.EXITED


def test_goes_idle_without_restart_when_precondition_false() -> None:
    consumer, _ = _consumer(precondition_holds=lambda: False)
    event = consumer.on_unexpected_exit()
    assert event is None
    assert consumer.restart_budget.exhausted is False  # no attempt was consumed
