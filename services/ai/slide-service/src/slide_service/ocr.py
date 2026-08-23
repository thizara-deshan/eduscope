from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from pathlib import Path

import pytesseract
from PIL import Image


class TesseractOcr:
    """Wraps pytesseract's blocking Tesseract call behind `asyncio.to_thread`.
    OCR failure or empty output returns `None` — the already-captured PNG is
    always kept regardless of OCR outcome."""

    async def extract(self, path: Path) -> str | None:
        return await asyncio.to_thread(self._extract_sync, path)

    @staticmethod
    def _extract_sync(path: Path) -> str | None:
        try:
            with Image.open(path) as image:
                raw = pytesseract.image_to_string(image, lang="eng", config="--oem 1 --psm 6")
        except Exception:
            return None
        normalized = " ".join(raw.split())
        return normalized or None


async def atomic_copy(source: Path, destination: Path) -> None:
    """Streams `source`'s bytes to `<destination>.tmp`, fsyncs the file,
    `os.replace`s it into place, then fsyncs the directory — a reader of
    `destination` never observes a partial file. Never overwrites an
    already-issued slide number; the caller allocates a fresh ordinal per
    candidate."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(destination.name + ".tmp")
    try:
        await asyncio.to_thread(_copy_and_fsync, source, temp_path)
        await asyncio.to_thread(os.replace, temp_path, destination)
        await asyncio.to_thread(_fsync_dir, destination.parent)
    except BaseException:
        with suppress(OSError):
            temp_path.unlink()
        raise


def _copy_and_fsync(source: Path, temp_path: Path) -> None:
    data = source.read_bytes()
    with open(temp_path, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def _fsync_dir(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
