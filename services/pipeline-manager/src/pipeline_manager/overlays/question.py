from __future__ import annotations

import io
import itertools
import os
from importlib.resources import files
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

from ..pipelines.projector import QuestionOverlay

# ── canvas ─────────────────────────────────────────────────────────────────
CANVAS_W = 1920
CANVAS_H = 1080
_MARGIN = 96

# The card is a static slide, not a quiz-result view: it holds prompt/options
# on the left and the join QR/code on the right, and — by construction — no
# participant, leaderboard, score, or answer-tally region (A-22, Q-31). The
# `extra="forbid"` `QuestionOverlay` model rejects those fields before a render
# is ever attempted; this file adds no place to draw them either.
_LEFT_W = 1200  # prompt + options column width
_RIGHT_X = _LEFT_W + _MARGIN  # QR/join column origin

_BG = (15, 23, 42)  # slate-900
_FG = (241, 245, 249)  # slate-100
_MUTED = (148, 163, 184)  # slate-400
_OPTION_BG = (30, 41, 59)  # slate-800
_CORRECT_BG = (22, 101, 52)  # green-800 — reveal-mode highlight only
_QR_LIGHT = (255, 255, 255)
_QR_DARK = (15, 23, 42)

_FONT_RESOURCE = "LiberationSans-Regular.ttf"
# Read the packaged font bytes once; `importlib.resources` keeps this correct
# whether the package is a directory or a wheel/zip on the board.
_FONT_BYTES = files("pipeline_manager.resources.projector").joinpath(_FONT_RESOURCE).read_bytes()

_id_counter = itertools.count(1)


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(io.BytesIO(_FONT_BYTES), size=size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    """Greedy word wrap by measured pixel width; also hard-splits a single word
    longer than the column so a 500-character prompt with no spaces still fits."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        current = ""
        for word in words:
            candidate = word if current == "" else f"{current} {word}"
            if draw.textlength(candidate, font=font) <= max_width or current == "":
                if draw.textlength(candidate, font=font) <= max_width:
                    current = candidate
                    continue
                # single token wider than the column: hard-split it
                chunk = ""
                for ch in word:
                    if draw.textlength(chunk + ch, font=font) <= max_width or chunk == "":
                        chunk += ch
                    else:
                        lines.append(chunk)
                        chunk = ch
                current = chunk
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def _draw_qr(draw_target: Image.Image, join_url: str, box: int, origin: tuple[int, int]) -> None:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(join_url)
    qr.make(fit=True)
    image = qr.make_image(fill_color=_QR_DARK, back_color=_QR_LIGHT).convert("RGB")
    # NEAREST keeps the modules crisp and the scaling deterministic.
    image = image.resize((box, box), Image.NEAREST)
    draw_target.paste(image, origin)


def render_question_card(payload: QuestionOverlay, runtime_dir: str | os.PathLike[str]) -> str:
    """Render a deterministic 1920×1080 question card and publish it atomically
    at `<runtime_dir>/projector/<publicationId>.png`.

    Same payload → same bytes (no timestamps, no random layout). The file is
    written to a unique same-directory temporary path, fsynced, then
    `os.replace`d onto the publication-id path so a reader never sees a partial
    image. Returns the final path.
    """
    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), _BG)
    draw = ImageDraw.Draw(canvas)

    prompt_font = _font(56)
    option_font = _font(44)
    label_font = _font(44)
    code_font = _font(72)
    caption_font = _font(36)

    # ── left column: prompt ──────────────────────────────────────────────
    y = _MARGIN
    for line in _wrap(draw, payload.prompt, prompt_font, _LEFT_W):
        draw.text((_MARGIN, y), line, font=prompt_font, fill=_FG)
        y += 72
    y += 48

    # ── left column: options ─────────────────────────────────────────────
    option_h = 108
    gap = 28
    for option in payload.options:
        correct = payload.correctOptionId is not None and option.id == payload.correctOptionId
        bg = _CORRECT_BG if correct else _OPTION_BG
        draw.rounded_rectangle(
            [(_MARGIN, y), (_MARGIN + _LEFT_W, y + option_h)],
            radius=16,
            fill=bg,
        )
        draw.text((_MARGIN + 32, y + 28), option.label, font=label_font, fill=_FG)
        # one wrapped line of option text is plenty at 300-char cap width
        text_lines = _wrap(draw, option.text, option_font, _LEFT_W - 160)
        draw.text((_MARGIN + 110, y + 28), text_lines[0], font=option_font, fill=_FG)
        y += option_h + gap

    # ── right column: join QR + human code ───────────────────────────────
    qr_box = 560
    qr_x = _RIGHT_X + ((CANVAS_W - _RIGHT_X - _MARGIN) - qr_box) // 2
    qr_y = _MARGIN + 40
    _draw_qr(canvas, payload.joinUrl, qr_box, (qr_x, qr_y))

    caption = "Scan to join"
    caption_w = draw.textlength(caption, font=caption_font)
    draw.text(
        (_RIGHT_X + ((CANVAS_W - _RIGHT_X - _MARGIN) - caption_w) // 2, qr_y + qr_box + 24),
        caption,
        font=caption_font,
        fill=_MUTED,
    )

    code = payload.joinCode
    code_w = draw.textlength(code, font=code_font)
    draw.text(
        (_RIGHT_X + ((CANVAS_W - _RIGHT_X - _MARGIN) - code_w) // 2, qr_y + qr_box + 96),
        code,
        font=code_font,
        fill=_FG,
    )

    # ── atomic publish ───────────────────────────────────────────────────
    projector_dir = Path(runtime_dir) / "projector"
    projector_dir.mkdir(parents=True, exist_ok=True)
    final_path = projector_dir / f"{payload.publicationId}.png"
    tmp_path = projector_dir / f".{payload.publicationId}.{os.getpid()}.{next(_id_counter)}.png.tmp"

    with open(tmp_path, "wb") as handle:
        canvas.save(handle, format="PNG", optimize=False, compress_level=6)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, final_path)
    return str(final_path)
