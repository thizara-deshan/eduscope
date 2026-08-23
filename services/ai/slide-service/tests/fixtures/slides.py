from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = (640, 480)
BACKGROUND = (255, 255, 255)
INK = (0, 0, 0)


def make_slide(
    path: Path, *, title: str, lines: list[str] | None = None, bg: tuple[int, int, int] = BACKGROUND
) -> None:
    ink = INK if bg == BACKGROUND else BACKGROUND
    image = Image.new("RGB", SIZE, bg)
    draw = ImageDraw.Draw(image)
    draw.text((20, 20), title, fill=ink)
    for index, line in enumerate(lines or []):
        draw.text((20, 70 + index * 30), line, fill=ink)
    image.save(path, "PNG")


def make_animation_build(path: Path, *, title: str, bullets: list[str], revealed: int) -> None:
    """One frame of a same-background animation build: `revealed` of
    `bullets` are drawn, increasing across the sequence."""
    make_slide(path, title=title, lines=bullets[:revealed])


def make_corrupt_png(path: Path) -> None:
    path.write_bytes(b"not a real png")


def make_zero_byte_png(path: Path) -> None:
    path.write_bytes(b"")
