from __future__ import annotations

import dataclasses

import pytest

from stt_service.recognizer import RecognizedUtterance, RecognizerLoop, VoskRecognizer

BLOCK_SIZE = 3200  # 100ms @ 16kHz mono S16LE


class FakeRecognizer:
    """Conforms to the `SpeechRecognizer` protocol directly (Mapping results,
    no JSON string layer) so `RecognizerLoop` tests stay independent of Vosk."""

    def __init__(self, is_final_sequence: list[bool], results: list[dict]) -> None:
        self._is_final_sequence = is_final_sequence
        self._results = results
        self._call = 0

    def accept_waveform(self, pcm: bytes) -> bool:
        is_final = self._is_final_sequence[self._call]
        self._call += 1
        return is_final

    def result(self) -> dict:
        return self._results.pop(0)

    def final_result(self) -> dict:
        return self._results.pop(0)


def test_recognized_utterance_is_immutable() -> None:
    utterance = RecognizedUtterance(start_sample=0, end_sample=100, text="hello world class", confidence=0.9)
    with pytest.raises(dataclasses.FrozenInstanceError):
        utterance.text = "changed"  # type: ignore[misc]


def test_short_utterances_are_filtered_longer_ones_survive() -> None:
    results = [
        {"text": "one"},
        {"text": "one two"},
        {"text": "one two three"},
        {"text": "one two three four five six seven eight"},
    ]
    recognizer = FakeRecognizer(is_final_sequence=[True, True, True, True], results=list(results))
    loop = RecognizerLoop(recognizer, min_words=3)

    outcomes = [loop.accept_block(bytes(BLOCK_SIZE)) for _ in range(4)]

    assert outcomes[0] is None
    assert outcomes[1] is None
    assert outcomes[2] is not None
    assert outcomes[3] is not None
    assert outcomes[2].text == "one two three"
    assert outcomes[3].text == "one two three four five six seven eight"


def test_confidence_is_nullable() -> None:
    recognizer = FakeRecognizer(
        is_final_sequence=[True, True],
        results=[{"text": "one two three", "confidence": 0.75}, {"text": "four five six"}],
    )
    loop = RecognizerLoop(recognizer, min_words=3)

    with_confidence = loop.accept_block(bytes(BLOCK_SIZE))
    without_confidence = loop.accept_block(bytes(BLOCK_SIZE))

    assert with_confidence.confidence == 0.75
    assert without_confidence.confidence is None


def test_sample_bounds_are_monotonic_across_utterances() -> None:
    recognizer = FakeRecognizer(
        is_final_sequence=[False, True, False, True],
        results=[{"text": "one two three"}, {"text": "four five six"}],
    )
    loop = RecognizerLoop(recognizer, min_words=3)

    loop.accept_block(bytes(BLOCK_SIZE))  # not final, no utterance
    first = loop.accept_block(bytes(BLOCK_SIZE))
    loop.accept_block(bytes(BLOCK_SIZE))  # not final, no utterance
    second = loop.accept_block(bytes(BLOCK_SIZE))

    assert first.start_sample == 0
    assert first.end_sample == 2 * (BLOCK_SIZE // 2)
    assert second.start_sample == first.end_sample
    assert second.end_sample > second.start_sample
    assert second.start_sample >= first.end_sample


def test_flush_calls_final_result_once_and_returns_at_most_one_utterance() -> None:
    calls = {"final_result": 0}

    class OnceRecognizer:
        def accept_waveform(self, pcm: bytes) -> bool:
            return False

        def result(self) -> dict:
            raise AssertionError("result() must not be called by flush()")

        def final_result(self) -> dict:
            calls["final_result"] += 1
            return {"text": "final partial phrase"}

    loop = RecognizerLoop(OnceRecognizer(), min_words=3)
    utterance = loop.flush()

    assert calls["final_result"] == 1
    assert utterance is not None
    assert utterance.text == "final partial phrase"


def test_flush_emits_nothing_for_empty_result() -> None:
    class EmptyRecognizer:
        def accept_waveform(self, pcm: bytes) -> bool:
            return False

        def result(self) -> dict:
            return {}

        def final_result(self) -> dict:
            return {"text": ""}

    loop = RecognizerLoop(EmptyRecognizer(), min_words=3)
    assert loop.flush() is None


class TestVoskRecognizerAdapter:
    def test_valid_json_result_is_parsed_to_a_mapping(self) -> None:
        class RawKaldi:
            def AcceptWaveform(self, pcm: bytes) -> bool:
                return True

            def Result(self) -> str:
                return '{"text": "one two three"}'

            def FinalResult(self) -> str:
                return '{"text": "final words here"}'

        adapter = VoskRecognizer(RawKaldi())
        assert adapter.accept_waveform(b"\x00\x00") is True
        assert adapter.result() == {"text": "one two three"}
        assert adapter.final_result() == {"text": "final words here"}

    def test_invalid_json_result_yields_empty_mapping(self) -> None:
        class BrokenKaldi:
            def AcceptWaveform(self, pcm: bytes) -> bool:
                return True

            def Result(self) -> str:
                return "not json"

            def FinalResult(self) -> str:
                return ""

        adapter = VoskRecognizer(BrokenKaldi())
        assert adapter.result() == {}
        assert adapter.final_result() == {}
