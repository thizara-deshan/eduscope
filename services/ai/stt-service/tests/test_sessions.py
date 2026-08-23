from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError

from stt_service.events import SttSegmentEvent, SttStateEvent
from stt_service.reader import DropOldestPcmRing
from stt_service.sessions import (
    AudioSourceStatus,
    ResumeSessionRequest,
    SessionActiveError,
    SessionNotFoundError,
    StartSessionRequest,
    SttSessionController,
    SttStatus,
)


class ScriptedRecognizer:
    """Conforms to `SpeechRecognizer` directly — mirrors C-02's `FakeRecognizer`."""

    def __init__(self, is_final_sequence: list[bool], results: list[dict]) -> None:
        self._is_final_sequence = list(is_final_sequence)
        self._results = list(results)
        self._call = 0

    def accept_waveform(self, pcm: bytes) -> bool:
        value = self._is_final_sequence[self._call]
        self._call += 1
        return value

    def result(self) -> dict:
        return self._results.pop(0)

    def final_result(self) -> dict:
        return self._results.pop(0)


class CrashingRecognizer:
    def accept_waveform(self, pcm: bytes) -> bool:
        raise RuntimeError("acoustic model died")

    def result(self) -> dict:
        return {}

    def final_result(self) -> dict:
        return {}


class ScriptedEngine:
    def __init__(self, recognizer_factory) -> None:
        self._factory = recognizer_factory

    def create_recognizer(self, sample_rate: int = 16000):
        return self._factory()


class FakeReader:
    def __init__(self, ring: DropOldestPcmRing) -> None:
        self.ring = ring
        self.started = False
        self.stopped = False

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True


class RecordingBroker:
    def __init__(self) -> None:
        self.events: list[tuple[str, object]] = []

    def publish(self, event: str, payload: object) -> int:
        self.events.append((event, payload))
        return len(self.events)


def make_controller(engine, *, broker=None, no_audio_after_sec: float = 10.0, min_words: int = 3):
    ring_holder: dict[str, DropOldestPcmRing] = {}
    reader_holder: dict[str, FakeReader] = {}

    def reader_factory(ring: DropOldestPcmRing) -> FakeReader:
        ring_holder["ring"] = ring
        reader = FakeReader(ring)
        reader_holder["reader"] = reader
        return reader

    controller = SttSessionController(
        engine=engine,
        reader_factory=reader_factory,
        broker=broker or RecordingBroker(),
        model_name="vosk",
        model_version="vosk-model-en-us-0.22",
        min_words=min_words,
        ring_blocks=600,
        no_audio_after_sec=no_audio_after_sec,
    )
    return controller, ring_holder, reader_holder


BLOCK = bytes(3200)


async def _settle() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


class TestLifecycle:
    async def test_one_active_session_raises_session_active(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.start("session-a", 0)
        with pytest.raises(SessionActiveError) as exc_info:
            await controller.start("session-b", 0)
        assert exc_info.value.session_id == "session-a"
        await controller.shutdown()

    async def test_same_session_start_is_idempotent_and_keeps_original_anchor(self) -> None:
        broker = RecordingBroker()
        recognizer = ScriptedRecognizer([True], [{"text": "one two three"}])
        controller, ring_holder, _ = make_controller(ScriptedEngine(lambda: recognizer), broker=broker)

        await controller.start("session-a", 0)
        await controller.start("session-a", 5000)  # must be ignored, not applied
        ring_holder["ring"].push(BLOCK)
        await _settle()

        segment_events = [payload for name, payload in broker.events if name == "evt.stt.segment"]
        assert len(segment_events) == 1
        assert segment_events[0].startOffsetMs == 0  # proves the 5000ms anchor never applied
        await controller.shutdown()

    async def test_pause_is_idempotent(self) -> None:
        controller, _, reader_holder = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.start("session-a", 0)
        await controller.pause("session-a")
        first_reader = reader_holder["reader"]
        await controller.pause("session-a")  # no error, no re-detach of an already-gone reader
        assert first_reader.stopped is True
        await controller.shutdown()

    async def test_resume_only_for_the_active_id(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.start("session-a", 0)
        await controller.pause("session-a")
        with pytest.raises(SessionNotFoundError):
            await controller.resume("session-b", 1000)
        await controller.shutdown()

    async def test_pause_wrong_session_id_raises_not_found(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.start("session-a", 0)
        with pytest.raises(SessionNotFoundError):
            await controller.pause("session-b")
        await controller.shutdown()

    async def test_no_emission_during_pause(self) -> None:
        broker = RecordingBroker()
        recognizer = ScriptedRecognizer([True], [{"text": "one two three"}])
        controller, ring_holder, _ = make_controller(ScriptedEngine(lambda: recognizer), broker=broker)

        await controller.start("session-a", 0)
        await controller.pause("session-a")
        ring_holder["ring"].push(BLOCK)  # the detached ring is never polled again
        await _settle()

        assert broker.events == []
        await controller.shutdown()

    async def test_resumed_first_sample_starts_at_supplied_anchor(self) -> None:
        broker = RecordingBroker()
        recognizer = ScriptedRecognizer([True], [{"text": "one two three"}])
        controller, ring_holder, _ = make_controller(ScriptedEngine(lambda: recognizer), broker=broker)

        await controller.start("session-a", 0)
        await controller.pause("session-a")
        await controller.resume("session-a", 42000)
        ring_holder["ring"].push(BLOCK)
        await _settle()

        segment_events = [payload for name, payload in broker.events if name == "evt.stt.segment"]
        assert len(segment_events) == 1
        assert segment_events[0].startOffsetMs == 42000
        assert segment_events[0].endOffsetMs == 42000 + (3200 // 2) // 16
        await controller.shutdown()

    async def test_offset_formula_is_anchor_plus_floor_samples_over_16(self) -> None:
        broker = RecordingBroker()
        recognizer = ScriptedRecognizer([False, True], [{"text": "one two three four"}])
        controller, ring_holder, _ = make_controller(ScriptedEngine(lambda: recognizer), broker=broker)

        await controller.start("session-a", 250)
        ring_holder["ring"].push(BLOCK)
        ring_holder["ring"].push(BLOCK)
        await _settle()

        segment_events = [payload for name, payload in broker.events if name == "evt.stt.segment"]
        assert len(segment_events) == 1
        assert segment_events[0].startOffsetMs == 250
        assert segment_events[0].endOffsetMs == 250 + 200  # 2 blocks * 1600 samples / 16
        await controller.shutdown()

    async def test_delete_flushes_one_final_valid_partial_utterance_then_idle(self) -> None:
        broker = RecordingBroker()
        recognizer = ScriptedRecognizer([False], [{"text": "final partial phrase"}])
        controller, ring_holder, reader_holder = make_controller(ScriptedEngine(lambda: recognizer), broker=broker)

        await controller.start("session-a", 0)
        ring_holder["ring"].push(BLOCK)
        await _settle()
        await controller.delete("session-a")

        segment_events = [payload for name, payload in broker.events if name == "evt.stt.segment"]
        assert len(segment_events) == 1
        assert segment_events[0].text == "final partial phrase"
        assert reader_holder["reader"].stopped is True
        status = controller.status()
        assert status.state == "idle"
        assert status.sessionId is None

    async def test_delete_is_idempotent_for_unknown_session(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.delete("never-started")  # must not raise
        status = controller.status()
        assert status.state == "idle"


class TestDegradation:
    async def test_no_audio_for_threshold_emits_degraded_then_recovers(self) -> None:
        broker = RecordingBroker()
        recognizer = ScriptedRecognizer([True], [{"text": "one two three"}])
        controller, ring_holder, _ = make_controller(ScriptedEngine(lambda: recognizer), broker=broker, no_audio_after_sec=0.02)

        await controller.start("session-a", 0)
        await asyncio.sleep(0.08)

        state_events = [payload for name, payload in broker.events if name == "evt.stt.state"]
        assert any(e.state == "degraded" and e.reason == "no-audio" for e in state_events)

        ring_holder["ring"].push(BLOCK)
        await _settle()
        await asyncio.sleep(0.01)

        state_events = [payload for name, payload in broker.events if name == "evt.stt.state"]
        assert any(e.state == "listening" for e in state_events)
        await controller.shutdown()


class TestHealth:
    async def test_idle_is_healthy(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        assert controller.is_healthy() is True

    async def test_active_session_with_live_pump_is_healthy(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.start("session-a", 0)
        assert controller.is_healthy() is True
        await controller.shutdown()

    async def test_paused_session_is_healthy(self) -> None:
        controller, _, _ = make_controller(ScriptedEngine(lambda: ScriptedRecognizer([], [])))
        await controller.start("session-a", 0)
        await controller.pause("session-a")
        assert controller.is_healthy() is True
        await controller.shutdown()

    async def test_dead_recognizer_loop_is_unhealthy(self) -> None:
        controller, ring_holder, _ = make_controller(ScriptedEngine(lambda: CrashingRecognizer()))
        await controller.start("session-a", 0)
        ring_holder["ring"].push(BLOCK)
        await _settle()
        assert controller.is_healthy() is False
        await controller.shutdown()


class TestStrictModels:
    @pytest.mark.parametrize(
        "model,kwargs",
        [
            (StartSessionRequest, {"sessionId": "s1", "anchorOffsetMs": 0, "extra": "nope"}),
            (ResumeSessionRequest, {"anchorOffsetMs": 0, "extra": "nope"}),
            (SttStatus, {
                "state": "idle", "sessionId": None, "model": None, "modelVersion": None,
                "samplesConsumed": None, "queueDepth": 0, "droppedBlocks": 0,
                "lastSegmentAt": None, "audioSource": None, "extra": "nope",
            }),
            (SttSegmentEvent, {
                "sessionId": "s1", "startOffsetMs": 0, "endOffsetMs": 1, "text": "hi",
                "confidence": None, "modelVersion": "v1", "extra": "nope",
            }),
            (SttStateEvent, {"sessionId": "s1", "state": "listening", "extra": "nope"}),
            (AudioSourceStatus, {"attached": True, "fps": None, "extra": "nope"}),
        ],
    )
    def test_extra_fields_are_forbidden(self, model, kwargs) -> None:
        with pytest.raises(ValidationError):
            model(**kwargs)

    def test_anchor_offset_must_be_nonnegative(self) -> None:
        with pytest.raises(ValidationError):
            StartSessionRequest(sessionId="s1", anchorOffsetMs=-1)
        with pytest.raises(ValidationError):
            ResumeSessionRequest(anchorOffsetMs=-1)
