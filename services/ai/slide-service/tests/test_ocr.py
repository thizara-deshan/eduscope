from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from slide_service.ocr import TesseractOcr, atomic_copy


def _make_minimal_png(path: Path) -> None:
    from PIL import Image

    Image.new("RGB", (4, 4), (255, 255, 255)).save(path, "PNG")


class TestTesseractOcr:
    async def test_calls_tesseract_with_exact_lang_and_config(self, tmp_path: Path) -> None:
        image_path = tmp_path / "slide.png"
        _make_minimal_png(image_path)

        captured: dict[str, object] = {}

        def fake_image_to_string(image, lang=None, config=None):
            captured["lang"] = lang
            captured["config"] = config
            return "hello"

        with patch("slide_service.ocr.pytesseract.image_to_string", side_effect=fake_image_to_string):
            text = await TesseractOcr().extract(image_path)

        assert captured["lang"] == "eng"
        assert captured["config"] == "--oem 1 --psm 6"
        assert text == "hello"

    async def test_normalizes_whitespace_and_preserves_unicode(self, tmp_path: Path) -> None:
        image_path = tmp_path / "slide.png"
        _make_minimal_png(image_path)

        raw = "  Énergie\n\tcannot   be\r\ndestroyed  "
        with patch("slide_service.ocr.pytesseract.image_to_string", return_value=raw):
            text = await TesseractOcr().extract(image_path)

        assert text == "Énergie cannot be destroyed"

    async def test_empty_output_returns_none(self, tmp_path: Path) -> None:
        image_path = tmp_path / "slide.png"
        _make_minimal_png(image_path)

        with patch("slide_service.ocr.pytesseract.image_to_string", return_value="   \n  "):
            text = await TesseractOcr().extract(image_path)

        assert text is None

    async def test_tesseract_error_returns_none_and_keeps_png(self, tmp_path: Path) -> None:
        image_path = tmp_path / "slide.png"
        _make_minimal_png(image_path)

        with patch(
            "slide_service.ocr.pytesseract.image_to_string", side_effect=RuntimeError("tesseract crashed")
        ):
            text = await TesseractOcr().extract(image_path)

        assert text is None
        assert image_path.exists()  # an OCR failure never touches the already-captured PNG


class TestAtomicCopy:
    async def test_writes_sibling_tmp_then_replaces(self, tmp_path: Path) -> None:
        source = tmp_path / "source.png"
        source.write_bytes(b"pretend-png-bytes")
        destination = tmp_path / "out" / "slide-001.png"

        await atomic_copy(source, destination)

        assert destination.read_bytes() == b"pretend-png-bytes"
        assert not destination.with_name(destination.name + ".tmp").exists()

    async def test_never_exposes_a_partial_final_file(self, tmp_path: Path) -> None:
        source = tmp_path / "source.png"
        source.write_bytes(b"a" * 1000)
        destination = tmp_path / "out" / "slide-001.png"

        import os as real_os

        seen_existed_before_replace: list[bool] = []
        original_replace = real_os.replace

        def spying_replace(src, dst):
            seen_existed_before_replace.append(Path(dst).exists())
            original_replace(src, dst)

        with patch("slide_service.ocr.os.replace", side_effect=spying_replace):
            await atomic_copy(source, destination)

        assert seen_existed_before_replace == [False]  # destination never existed before the atomic replace
        assert destination.read_bytes() == b"a" * 1000

    async def test_creates_destination_directory(self, tmp_path: Path) -> None:
        source = tmp_path / "source.png"
        source.write_bytes(b"bytes")
        destination = tmp_path / "nested" / "deeper" / "slide-001.png"

        await atomic_copy(source, destination)

        assert destination.exists()

    async def test_deletes_temp_file_on_failure(self, tmp_path: Path) -> None:
        source = tmp_path / "source.png"
        source.write_bytes(b"bytes")
        destination = tmp_path / "out" / "slide-001.png"

        with patch("slide_service.ocr.os.replace", side_effect=OSError("disk full")):
            try:
                await atomic_copy(source, destination)
            except OSError:
                pass

        assert not destination.with_name(destination.name + ".tmp").exists()
        assert not destination.exists()
