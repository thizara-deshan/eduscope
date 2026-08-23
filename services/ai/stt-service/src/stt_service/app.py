from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from eduscope_ai_common import SseBroker, configure_logging, require_bearer
from eduscope_ai_common.auth import UnauthorizedError, unauthorized_handler

from .reader import DropOldestPcmRing, GstShmReader
from .recognizer import VoskEngine
from .sessions import (
    ReaderFactory,
    ResumeSessionRequest,
    SessionActiveError,
    SessionNotFoundError,
    StartSessionRequest,
    SttSessionController,
    SttStatus,
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EDUSCOPE_STT_", extra="ignore")

    bind_host: str = "127.0.0.1"
    port: int = Field(default=7101, ge=1, le=65535)
    internal_bearer: str = Field(min_length=32)
    audio_socket: str = "/tmp/audio.sock"
    model_path: str = "/opt/eduscope/models/vosk-model-en-us-0.22"
    model_version: str = "vosk-model-en-us-0.22"
    ring_blocks: int = Field(default=600, ge=1, le=4096)
    min_words: int = Field(default=3, ge=1)
    no_audio_after_sec: float = Field(default=10.0, gt=0)

    @field_validator("bind_host")
    @classmethod
    def localhost_only(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("stt-service must bind to 127.0.0.1")
        return value


def _problem(code: str, title: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "title": title, "status": status})


async def _domain_problem_handler(_request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, SessionActiveError):
        return _problem("session_active", "An STT session is already active", 409)
    if isinstance(exc, SessionNotFoundError):
        return _problem("session_not_found", "No matching STT session", 404)
    raise exc  # pragma: no cover - defensive; every registered type is handled above


async def _validation_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return _problem("invalid_request", "Request validation failed", 422)


def create_app(
    settings: Settings | None = None,
    *,
    engine=None,
    reader_factory: ReaderFactory | None = None,
) -> FastAPI:
    settings = settings or Settings()
    logger = configure_logging("stt")
    broker = SseBroker()
    bearer_dependency = require_bearer(settings.internal_bearer)

    engine = engine if engine is not None else VoskEngine(settings.model_path)
    if reader_factory is None:
        def reader_factory(ring: DropOldestPcmRing) -> GstShmReader:
            return GstShmReader(settings.audio_socket, ring)

    controller = SttSessionController(
        engine=engine,
        reader_factory=reader_factory,
        broker=broker,
        model_name="vosk",
        model_version=settings.model_version,
        min_words=settings.min_words,
        ring_blocks=settings.ring_blocks,
        no_audio_after_sec=settings.no_audio_after_sec,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("stt-service ready")
        try:
            yield
        finally:
            await controller.shutdown()

    app = FastAPI(lifespan=lifespan)
    app.state.controller = controller
    app.state.broker = broker
    app.add_exception_handler(UnauthorizedError, unauthorized_handler)
    app.add_exception_handler(SessionActiveError, _domain_problem_handler)
    app.add_exception_handler(SessionNotFoundError, _domain_problem_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        if controller.is_healthy():
            return JSONResponse(status_code=200, content={"status": "ok"})
        return JSONResponse(status_code=503, content={"status": "degraded"})

    @app.get("/status", dependencies=[Depends(bearer_dependency)], response_model=SttStatus)
    async def get_status() -> SttStatus:
        return controller.status()

    @app.get("/events", dependencies=[Depends(bearer_dependency)])
    async def events() -> StreamingResponse:
        return StreamingResponse(broker.subscribe(), media_type="text/event-stream")

    @app.post("/sessions", status_code=202, dependencies=[Depends(bearer_dependency)])
    async def start_session(body: StartSessionRequest) -> dict:
        await controller.start(body.sessionId, body.anchorOffsetMs)
        return {"state": "listening"}

    @app.post("/sessions/{session_id}/pause", status_code=202, dependencies=[Depends(bearer_dependency)])
    async def pause_session(session_id: str) -> dict:
        await controller.pause(session_id)
        return {"state": "paused"}

    @app.post("/sessions/{session_id}/resume", status_code=202, dependencies=[Depends(bearer_dependency)])
    async def resume_session(session_id: str, body: ResumeSessionRequest) -> dict:
        await controller.resume(session_id, body.anchorOffsetMs)
        return {"state": "listening"}

    @app.delete("/sessions/{session_id}", status_code=202, dependencies=[Depends(bearer_dependency)])
    async def delete_session(session_id: str) -> dict:
        await controller.delete(session_id)
        return {"state": "idle"}

    return app


def main() -> None:
    import uvicorn

    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.bind_host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()
