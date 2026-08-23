"""Synthesizes a deterministic prerecorded 16 kHz mono S16LE PCM fixture for
C-02 Step 6's live shm-reader integration check. Argv-only `espeak-ng` piped
through argv-only `ffmpeg` — no shell string, no `sudo`. Exits with a clear
skip code when either executable is absent so the automated suite never
depends on this fixture existing.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SKIP_EXIT_CODE = 77
PHRASE = "energy cannot be created or destroyed"
OUTPUT_PATH = Path(__file__).parent / "lecture-en-16k-mono.pcm"


def main() -> int:
    espeak = shutil.which("espeak-ng")
    ffmpeg = shutil.which("ffmpeg")
    if espeak is None or ffmpeg is None:
        missing = [name for name, path in (("espeak-ng", espeak), ("ffmpeg", ffmpeg)) if path is None]
        print(f"SKIP: missing required executable(s): {', '.join(missing)}", file=sys.stderr)
        return SKIP_EXIT_CODE

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "lecture.wav"
        subprocess.run(
            [espeak, "-v", "en", "-s", "150", "-w", str(wav_path), PHRASE],
            check=True,
            shell=False,
        )
        subprocess.run(
            [
                ffmpeg, "-y", "-loglevel", "error",
                "-i", str(wav_path),
                "-ar", "16000", "-ac", "1", "-f", "s16le",
                str(OUTPUT_PATH),
            ],
            check=True,
            shell=False,
        )

    digest = hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest()
    print(f"wrote {OUTPUT_PATH} sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
