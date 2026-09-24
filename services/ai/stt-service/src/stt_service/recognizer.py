from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

SAMPLES_PER_MS = 16  # 16kHz mono


class SpeechRecognizer(Protocol):
    def accept_waveform(self, pcm: bytes) -> bool: ...
    def partial_result(self) -> Mapping[str, object]: ...
    def result(self) -> Mapping[str, object]: ...
    def final_result(self) -> Mapping[str, object]: ...


@dataclass(frozen=True)
class RecognizedUtterance:
    start_sample: int
    end_sample: int
    text: str
    confidence: float | None


@dataclass(frozen=True)
class RecognizedPartial:
    start_sample: int
    end_sample: int
    text: str


class RecognizerLoop:
    """Consumes 100ms PCM blocks, tracking `samplesConsumed` for the current
    capture span. `MIN_WORDS_PER_SEGMENT` filtering drops noise utterances
    ("uh") without touching the LLM — stt-service never calls the LLM at all
    (question-service does)."""

    def __init__(self, recognizer: SpeechRecognizer, *, min_words: int = 3, partial_every_blocks: int = 3) -> None:
        self._recognizer = recognizer
        self._min_words = min_words
        self.samples_consumed = 0
        self._utterance_start_sample = 0
        self._partial_every_blocks = partial_every_blocks
        self._blocks_since_partial = 0
        self._last_partial_text = ""

    def accept_block(self, pcm: bytes) -> tuple[RecognizedUtterance | None, RecognizedPartial | None]:
        is_final = self._recognizer.accept_waveform(pcm)
        self.samples_consumed += len(pcm) // 2
        self._blocks_since_partial += 1
        if is_final:
            utterance = self._extract(self._recognizer.result())
            self._utterance_start_sample = self.samples_consumed
            self._blocks_since_partial = 0
            self._last_partial_text = ""
            return utterance, None
        if self._blocks_since_partial < self._partial_every_blocks:
            return None, None
        self._blocks_since_partial = 0
        raw = self._recognizer.partial_result()
        text = raw.get("partial")
        normalized = " ".join(text.split()) if isinstance(text, str) else ""
        if not normalized or normalized == self._last_partial_text:
            return None, None
        self._last_partial_text = normalized
        return None, RecognizedPartial(
            start_sample=self._utterance_start_sample,
            end_sample=self.samples_consumed,
            text=normalized,
        )

    def flush(self) -> RecognizedUtterance | None:
        utterance = self._extract(self._recognizer.final_result())
        self._utterance_start_sample = self.samples_consumed
        return utterance

    def _extract(self, raw: Mapping[str, object]) -> RecognizedUtterance | None:
        text = raw.get("text")
        if not isinstance(text, str):
            return None
        normalized = " ".join(text.split())
        if not normalized:
            return None
        if len(normalized.split(" ")) < self._min_words:
            return None
        confidence_raw = raw.get("confidence")
        confidence = float(confidence_raw) if isinstance(confidence_raw, (int, float)) else None
        return RecognizedUtterance(
            start_sample=self._utterance_start_sample,
            end_sample=self.samples_consumed,
            text=normalized,
            confidence=confidence,
        )


class VoskRecognizer:
    """Adapts a real `vosk.KaldiRecognizer`'s JSON-string API to the
    Mapping-returning `SpeechRecognizer` protocol. Invalid/empty JSON yields
    an empty mapping rather than raising — `RecognizerLoop` already treats a
    missing/blank `text` field as "nothing to emit"."""

    def __init__(self, kaldi_recognizer: object) -> None:
        self._kaldi_recognizer = kaldi_recognizer

    def accept_waveform(self, pcm: bytes) -> bool:
        return bool(self._kaldi_recognizer.AcceptWaveform(pcm))  # type: ignore[attr-defined]

    def result(self) -> Mapping[str, object]:
        return self._parse(self._kaldi_recognizer.Result())  # type: ignore[attr-defined]

    def partial_result(self) -> Mapping[str, object]:
        return self._parse(self._kaldi_recognizer.PartialResult())  # type: ignore[attr-defined]

    def final_result(self) -> Mapping[str, object]:
        return self._parse(self._kaldi_recognizer.FinalResult())  # type: ignore[attr-defined]

    @staticmethod
    def _parse(raw: str) -> Mapping[str, object]:
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            return {}
        return value if isinstance(value, dict) else {}


class VoskEngine:
    """Loads the Vosk acoustic model exactly once at service start (model
    load is ~10-20s — the service starts at boot, not per lecture); each
    session gets only a fresh `KaldiRecognizer` from the already-loaded model."""

    def __init__(self, model_path: str) -> None:
        import vosk  # imported lazily so hermetic tests never need it installed

        self._vosk = vosk
        self._model = vosk.Model(model_path)

    def create_recognizer(self, sample_rate: int = 16000) -> VoskRecognizer:
        kaldi_recognizer = self._vosk.KaldiRecognizer(self._model, sample_rate)
        kaldi_recognizer.SetWords(False)
        return VoskRecognizer(kaldi_recognizer)
