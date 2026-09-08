from __future__ import annotations

import pytest

from pipeline_manager.consumers.base import RestartClass
from pipeline_manager.consumers.projector import ProjectorConsumer
from pipeline_manager.models import ConsumerState
from pipeline_manager.pipelines.platforms.rk3588 import RK3588Profile
from pipeline_manager.pipelines.projector import ProjectorMode, QuestionOverlay
from pipeline_manager.supervisor.ledger import EncodeLedger

from .conftest import FakeConfirmer, FakeSupervisor


def _consumer(precondition_holds=lambda: True, runtime_dir=None):
    supervisor = FakeSupervisor()
    consumer = ProjectorConsumer(
        "projector:1",
        platform=RK3588Profile(),
        precondition_holds=precondition_holds,
        runtime_dir=runtime_dir,
        supervisor=supervisor,
        ledger=EncodeLedger(),
        confirmer=FakeConfirmer(),
    )
    return consumer, supervisor


def _question(**overrides):
    data = {
        "publicationId": "pub-1",
        "prompt": "Q?",
        "options": [
            {"id": "o1", "label": "A", "text": "a"},
            {"id": "o2", "label": "B", "text": "b"},
        ],
        "joinUrl": "https://quiz.example.edu/j/CONS01",
        "joinCode": "CONS01",
    }
    data.update(overrides)
    return QuestionOverlay.model_validate(data)


def test_restart_class_is_display() -> None:
    consumer, _ = _consumer()
    assert consumer.restart_class is RestartClass.DISPLAY


@pytest.mark.asyncio
async def test_mode_switch_does_not_spawn_a_second_child(tmp_path) -> None:
    consumer, supervisor = _consumer(runtime_dir=tmp_path)
    await consumer.start()
    assert len(supervisor.calls) == 1

    consumer.set_mode(ProjectorMode.QUESTION, _question())
    consumer.set_mode(ProjectorMode.PASSTHROUGH)

    assert len(supervisor.calls) == 1  # still just the one worker


@pytest.mark.asyncio
async def test_question_mode_renders_a_card_and_sends_its_path(tmp_path) -> None:
    consumer, _ = _consumer(runtime_dir=tmp_path)
    await consumer.start()

    consumer.set_mode(ProjectorMode.QUESTION, _question(publicationId="pub-render"))

    card = tmp_path / "projector" / "pub-render.png"
    assert card.exists()
    frame = consumer.process.popen.stdin.written[-1]
    assert str(card).encode() in frame
    # the rendered card holds the question, not the control frame
    assert b"Q?" not in frame


@pytest.mark.asyncio
async def test_superseded_cards_are_cleaned_up(tmp_path) -> None:
    consumer, _ = _consumer(runtime_dir=tmp_path)
    await consumer.start()
    for i in range(5):
        consumer.set_mode(ProjectorMode.QUESTION, _question(publicationId=f"pub-{i}"))
    remaining = sorted(p.name for p in (tmp_path / "projector").glob("*.png"))
    # bounded history: only the most recent cards survive
    assert remaining == ["pub-3.png", "pub-4.png"]


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
