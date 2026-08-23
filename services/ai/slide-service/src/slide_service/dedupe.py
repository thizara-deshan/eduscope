from __future__ import annotations

import itertools
from dataclasses import dataclass
from pathlib import Path

import imagehash
from PIL import Image

HASH_SIZE = 8


@dataclass(frozen=True)
class FinalizedCandidate:
    source_path: Path
    observed_offset_ms: int
    dedupe_hash: str


@dataclass
class _PendingCandidate:
    temp_path: Path
    offset_ms: int
    phash: imagehash.ImageHash

    def finalize(self) -> FinalizedCandidate:
        return FinalizedCandidate(
            source_path=self.temp_path,
            observed_offset_ms=self.offset_ms,
            dedupe_hash=str(self.phash),
        )


class SlideCandidateMachine:
    """Deduplicates a stream of observed snapshot frames into one
    representative "candidate" per distinct slide, using perceptual-hash
    (pHash) distance. Every observation is copied into a session-owned
    temporary file *before* hashing so a later atomic replacement of the
    live source cannot mutate a candidate still pending finalization; only
    the copy is resized for hashing, the stored bytes stay full-resolution.
    """

    def __init__(self, *, temp_dir: Path, threshold: int = 10, hash_size: int = HASH_SIZE) -> None:
        self._temp_dir = temp_dir
        self._threshold = threshold
        self._hash_size = hash_size
        self._pending: _PendingCandidate | None = None
        self._counter = itertools.count(1)

    def observe(self, path: Path, offset_ms: int) -> FinalizedCandidate | None:
        temp_path = self._copy_to_temp(path)
        phash = self._hash(temp_path)

        if self._pending is None:
            self._pending = _PendingCandidate(temp_path=temp_path, offset_ms=offset_ms, phash=phash)
            return None

        distance = self._pending.phash - phash
        if distance <= self._threshold:
            stale_path = self._pending.temp_path
            self._pending = _PendingCandidate(temp_path=temp_path, offset_ms=offset_ms, phash=phash)
            stale_path.unlink(missing_ok=True)
            return None

        finalized = self._pending.finalize()
        self._pending = _PendingCandidate(temp_path=temp_path, offset_ms=offset_ms, phash=phash)
        return finalized

    def finalize_pending(self) -> FinalizedCandidate | None:
        if self._pending is None:
            return None
        finalized = self._pending.finalize()
        self._pending = None
        return finalized

    def _copy_to_temp(self, source: Path) -> Path:
        destination = self._temp_dir / f"candidate-{next(self._counter):06d}.png"
        destination.write_bytes(source.read_bytes())
        return destination

    def _hash(self, path: Path) -> imagehash.ImageHash:
        with Image.open(path) as image:
            return imagehash.phash(image, hash_size=self._hash_size)
