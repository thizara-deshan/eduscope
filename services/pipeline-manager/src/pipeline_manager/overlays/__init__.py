"""Server-side projector overlay rendering (E-49).

`render_question_card` turns a validated `QuestionOverlay` into a deterministic
1920×1080 PNG the projector worker overlays with a single
`gdkpixbufoverlay.location` swap — question text, options, join code, and a
scannable join-URL QR are baked into the image here, never interpolated into
argv or a GStreamer property string.
"""

from .question import render_question_card

__all__ = ["render_question_card"]
