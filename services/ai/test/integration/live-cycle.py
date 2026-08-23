"""C-09 hermetic fixture-stack CLI for the cross-service AI integration gate.

`--serve-fixtures` starts the three real C FastAPI apps (stt-service,
slide-service, question-service) behind injected deterministic seams plus a
small fixture llama.cpp stand-in, all on ephemeral loopback ports. It writes
exactly one JSON `ready` line, then accepts newline-delimited JSON stdin
commands (`pcm`, `slide`, `llm-offline`, `llm-online`, `restart-stt`,
`restart-slide`, `stop`), acking each on its own stdout line. It never prints
tokens, prompts, transcript text, or LLM URLs containing credentials.

This module intentionally has no import-time side effects beyond stdlib/
third-party imports so `test_fixture_stack.py` can drive it as a real
subprocess (its filename is not a valid Python module name for `import`).
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import socket
import sys
import tempfile
import threading
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, Request
from pydantic import BaseModel, ConfigDict, ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stt-service" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "slide-service" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "question-service" / "src"))

from stt_service.app import Settings as SttSettings  # noqa: E402
from stt_service.app import create_app as stt_create_app  # noqa: E402
from stt_service.reader import DropOldestPcmRing  # noqa: E402
from slide_service.app import Settings as SlideSettings  # noqa: E402
from slide_service.app import create_app as slide_create_app  # noqa: E402
from question_service.app import Settings as QuestionSettings  # noqa: E402
from question_service.app import create_app as question_create_app  # noqa: E402

_STT_PHRASE = "the second law tells us"
_STT_CONFIDENCE = 0.87


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: Literal["pcm", "slide", "llm-offline", "llm-online", "restart-stt", "restart-slide", "stop"]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _make_slide_png(seed: int) -> bytes:
    """A small, mutually-distinct (pHash-different) PNG so consecutive
    fixture slides are never deduplicated into the same candidate."""
    from PIL import Image, ImageDraw

    bg = (20, 20, 20) if seed % 2 else (235, 235, 235)
    fg = (235, 235, 235) if seed % 2 else (20, 20, 20)
    image = Image.new("RGB", (240, 180), bg)
    draw = ImageDraw.Draw(image)
    draw.rectangle([10, 10 + (seed * 15) % 100, 230, 40 + (seed * 15) % 100], fill=fg)
    draw.text((15, 140), f"fixture slide {seed}", fill=fg)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class _FixtureRecognizer:
    """Every block finalizes immediately with a fixed, >=3-word phrase —
    deterministic, hermetic, no Vosk/GStreamer involved."""

    def accept_waveform(self, pcm: bytes) -> bool:
        return True

    def result(self) -> dict:
        return {"text": _STT_PHRASE, "confidence": _STT_CONFIDENCE}

    def final_result(self) -> dict:
        return {"text": _STT_PHRASE, "confidence": _STT_CONFIDENCE}


class _FixtureEngine:
    def create_recognizer(self, sample_rate: int = 16000) -> _FixtureRecognizer:
        return _FixtureRecognizer()


class _NoopReader:
    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None


class _FixtureWatcher:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[Path | None] = asyncio.Queue()

    def push(self, path: Path) -> None:
        self._queue.put_nowait(path)

    async def frames(self) -> AsyncIterator[Path]:
        while True:
            item = await self._queue.get()
            if item is None:
                return
            yield item


class _FixtureOcr:
    async def extract(self, path: Path) -> str | None:
        return "fixture slide text"


class _AppRunner:
    """Binds one FastAPI app on a fixed loopback port; `restart()` tears the
    ASGI lifespan down and rebuilds a brand-new app instance on the same
    port, exactly reproducing a real process restart's effect (in-memory
    session state lost) without a second OS process."""

    def __init__(self, host: str, port: int, app_factory: Callable[[], FastAPI]) -> None:
        self._host = host
        self._port = port
        self._app_factory = app_factory
        self._server: uvicorn.Server | None = None
        self._task: asyncio.Task | None = None

    @property
    def base_url(self) -> str:
        return f"http://{self._host}:{self._port}"

    async def start(self) -> None:
        app = self._app_factory()
        # `timeout_graceful_shutdown` bounds how long uvicorn waits for an
        # open connection to close on its own before cancelling its task —
        # without it (default: wait forever), a still-open SSE `/events`
        # stream (a real, long-lived consumer, not idle keep-alive) leaves
        # `stop()` hanging indefinitely. A restart needs that connection torn
        # down promptly, matching what a real process kill/restart forces.
        config = uvicorn.Config(app, host=self._host, port=self._port, log_level="warning", lifespan="on", timeout_graceful_shutdown=1)
        self._server = uvicorn.Server(config)
        self._task = asyncio.create_task(self._server.serve())
        async with asyncio.timeout(10.0):
            while not self._server.started:
                await asyncio.sleep(0.01)

    async def stop(self) -> None:
        """Graceful shutdown, with a forced cancel fallback — an open SSE
        `/events` stream (a real, long-lived consumer, not an idle
        keep-alive) otherwise leaves uvicorn's graceful shutdown waiting for
        a connection its own client never closes. A real process
        kill/restart would tear that connection down too, so cancelling
        after a short grace period is the faithful behavior here, not a
        compromise."""
        server = self._server
        task = self._task
        self._server = None
        self._task = None
        if server is not None:
            server.should_exit = True
        if task is not None:
            try:
                async with asyncio.timeout(5.0):
                    await task
            except TimeoutError:
                task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await task

    async def restart(self) -> None:
        await self.stop()
        await self.start()


class FixtureStack:
    """Owns the three real C apps plus a fixture llama.cpp stand-in on
    ephemeral loopback ports, and the injected seams the `pcm`/`slide`/
    `llm-offline`/`llm-online`/`restart-*` commands act on."""

    def __init__(self, *, bearer: str, runtime_root: Path, recordings_root: Path) -> None:
        self._bearer = bearer
        self._runtime_root = runtime_root
        self._recordings_root = recordings_root

        self._stt_ring: dict[str, DropOldestPcmRing] = {}
        self._slide_watcher: dict[str, _FixtureWatcher] = {}
        self._slide_seed = 0

        self._stt = _AppRunner("127.0.0.1", _free_port(), self._build_stt_app)
        self._slide = _AppRunner("127.0.0.1", _free_port(), self._build_slide_app)
        self._question = _AppRunner("127.0.0.1", _free_port(), self._build_question_app)
        self._llama = _AppRunner("127.0.0.1", _free_port(), self._build_llama_app)
        # Order matters for `stop()`: reverse of startup so a service that
        # depends on another (question -> llama) never outlives it.
        self._runners: tuple[_AppRunner, ...] = (self._stt, self._slide, self._question, self._llama)

    def _build_stt_app(self) -> FastAPI:
        self._stt_ring.clear()

        def reader_factory(ring: DropOldestPcmRing) -> _NoopReader:
            self._stt_ring["ring"] = ring
            return _NoopReader()

        # `settings.port` is unused here — uvicorn.Config binds the runner's own fixed port.
        settings = SttSettings(internal_bearer=self._bearer, bind_host="127.0.0.1")
        return stt_create_app(settings, engine=_FixtureEngine(), reader_factory=reader_factory)

    def _build_slide_app(self) -> FastAPI:
        self._slide_watcher.clear()

        def watcher_factory(source_path: Path) -> _FixtureWatcher:
            watcher = _FixtureWatcher()
            self._slide_watcher["watcher"] = watcher
            return watcher

        settings = SlideSettings(
            internal_bearer=self._bearer,
            bind_host="127.0.0.1",
            runtime_root=str(self._runtime_root),
            recordings_root=str(self._recordings_root),
        )
        return slide_create_app(settings, watcher_factory=watcher_factory, ocr_engine=_FixtureOcr())

    def _build_question_app(self) -> FastAPI:
        settings = QuestionSettings(internal_bearer=self._bearer, bind_host="127.0.0.1")
        return question_create_app(settings)

    def _build_llama_app(self) -> FastAPI:
        app = FastAPI()

        @app.get("/health")
        async def health() -> dict:
            return {"status": "ok", "model": "fixture-llama"}

        @app.post("/completion")
        async def completion(_request: Request) -> dict:
            questions = [
                {
                    "prompt": f"Fixture question {i}?",
                    "options": [
                        {"text": "Correct answer", "isCorrect": True},
                        {"text": f"Wrong answer {i}", "isCorrect": False},
                    ],
                }
                for i in range(1, 5)
            ]
            return {"content": json.dumps(questions), "model": "fixture-llama"}

        return app

    async def start(self) -> dict[str, str]:
        for runner in (self._stt, self._slide, self._question, self._llama):
            await runner.start()
        return {
            "stt": self._stt.base_url,
            "slide": self._slide.base_url,
            "question": self._question.base_url,
            "llama": self._llama.base_url,
        }

    async def stop(self) -> None:
        for runner in reversed(self._runners):
            await runner.stop()

    async def handle(self, command: str) -> None:
        if command == "pcm":
            ring = self._stt_ring.get("ring")
            if ring is not None:
                ring.push(bytes(3200))
        elif command == "slide":
            watcher = self._slide_watcher.get("watcher")
            if watcher is not None:
                self._slide_seed += 1
                png_bytes = _make_slide_png(self._slide_seed)
                path = Path(tempfile.mkstemp(prefix="fixture-slide-", suffix=".png")[1])
                path.write_bytes(png_bytes)
                watcher.push(path)
        elif command == "llm-offline":
            await self._llama.stop()
        elif command == "llm-online":
            await self._llama.start()
        elif command == "restart-stt":
            await self._stt.restart()
        elif command == "restart-slide":
            await self._slide.restart()
        elif command == "stop":
            return
        else:  # pragma: no cover - Command's Literal already excludes this
            raise ValueError(f"unknown command: {command}")


async def _stdin_lines() -> AsyncIterator[str]:
    """Bridges blocking `sys.stdin` into an async iterator via one reader
    thread so the event loop stays free for the FastAPI apps."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    def _reader() -> None:
        try:
            for raw_line in sys.stdin:
                loop.call_soon_threadsafe(queue.put_nowait, raw_line)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    thread = threading.Thread(target=_reader, daemon=True)
    thread.start()
    try:
        while True:
            line = await queue.get()
            if line is None:
                return
            yield line
    finally:
        thread.join(timeout=0.1)


async def run_command_loop(stack: FixtureStack, lines: AsyncIterator[str], out) -> None:
    """Drives one command-loop pass over `lines`, acking/erroring to `out`.
    Exits on a `stop` command or when `lines` is exhausted (EOF) — the
    caller is responsible for `stack.stop()` afterward."""
    async for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped:
            continue
        try:
            parsed = json.loads(stripped)
            cmd = Command.model_validate(parsed)
        except (json.JSONDecodeError, ValidationError):
            out.write(json.dumps({"type": "error", "message": "invalid command"}) + "\n")
            out.flush()
            continue

        await stack.handle(cmd.command)
        out.write(json.dumps({"type": "ack", "command": cmd.command}) + "\n")
        out.flush()
        if cmd.command == "stop":
            return


async def serve_fixtures(*, bearer: str, runtime_root: Path, recordings_root: Path, out=sys.stdout) -> None:
    stack = FixtureStack(bearer=bearer, runtime_root=runtime_root, recordings_root=recordings_root)
    ready = await stack.start()
    out.write(json.dumps({"type": "ready", **ready}) + "\n")
    out.flush()
    try:
        await run_command_loop(stack, _stdin_lines(), out)
    finally:
        await stack.stop()


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve-fixtures", action="store_true", required=True)
    parser.add_argument("--bearer", default="fixture-stack-internal-bearer-0123456789")
    parser.add_argument("--runtime-root", type=Path, default=None)
    parser.add_argument("--recordings-root", type=Path, default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    runtime_root = args.runtime_root or Path(tempfile.mkdtemp(prefix="fixture-runtime-"))
    recordings_root = args.recordings_root or Path(tempfile.mkdtemp(prefix="fixture-recordings-"))
    asyncio.run(serve_fixtures(bearer=args.bearer, runtime_root=runtime_root, recordings_root=recordings_root))


if __name__ == "__main__":
    main()
