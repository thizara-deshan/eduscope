from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from eduscope_ai_common import SseBroker, configure_logging, require_bearer
from eduscope_ai_common.auth import UnauthorizedError, unauthorized_handler

from .ocr import TesseractOcr
from .sessions import (
    InvalidSlidePathError,
    ResumeSlideSessionRequest,
    SessionActiveError,
    SessionNotFoundError,
    SlideSessionController,
    SlideStatus,
    StartSlideSessionRequest,
    WatcherFactory,
)
from .watch import SnapshotWatcher


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EDUSCOPE_SLIDE_", extra="ignore")

    bind_host: str = "127.0.0.1"
    port: int = Field(default=7102, ge=1, le=65535)
    internal_bearer: str = Field(min_length=32)
    runtime_root: str = "/run/eduscope"
    recordings_root: str = "/media/eduscope/recordings"
    phash_threshold: int = Field(default=10, ge=0)
    poll_interval_sec: float = Field(default=1.0, gt=0)
    ocr_queue_size: int = Field(default=4, ge=1)

    @field_validator("bind_host")
    @classmethod
    def localhost_only(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("slide-service must bind to 127.0.0.1")
        return value


def _problem(code: str, title: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "title": title, "status": status})


async def _domain_problem_handler(_request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, SessionActiveError):
        return _problem("session_active", "A slide session is already active", 409)
    if isinstance(exc, SessionNotFoundError):
        return _problem("session_not_found", "No matching slide session", 404)
    if isinstance(exc, InvalidSlidePathError):
        return _problem("invalid_path", str(exc), 400)
    raise exc  # pragma: no cover - defensive; every registered type is handled above


async def _validation_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return _problem("invalid_request", "Request validation failed", 422)


def create_app(
    settings: Settings | None = None,
    *,
    watcher_factory: WatcherFactory | None = None,
    ocr_engine=None,
) -> FastAPI:
    settings = settings or Settings()
    logger = configure_logging("slide")
    broker = SseBroker()
    bearer_dependency = require_bearer(settings.internal_bearer)

    ocr_engine = ocr_engine if ocr_engine is not None else TesseractOcr()
    if watcher_factory is None:
        def watcher_factory(source_path: Path) -> SnapshotWatcher:
            return SnapshotWatcher(source_path, poll_interval=settings.poll_interval_sec)

    controller = SlideSessionController(
        watcher_factory=watcher_factory,
        ocr_engine=ocr_engine,
        broker=broker,
        runtime_root=Path(settings.runtime_root),
        recordings_root=Path(settings.recordings_root),
        threshold=settings.phash_threshold,
        ocr_queue_size=settings.ocr_queue_size,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("slide-service ready")
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
    app.add_exception_handler(InvalidSlidePathError, _domain_problem_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        if controller.is_healthy():
            return JSONResponse(status_code=200, content={"status": "ok"})
        return JSONResponse(status_code=503, content={"status": "degraded"})

    @app.get("/status", dependencies=[Depends(bearer_dependency)], response_model=SlideStatus)
    async def get_status() -> SlideStatus:
        return controller.status()

    @app.get("/events", dependencies=[Depends(bearer_dependency)])
    async def events() -> StreamingResponse:
        return StreamingResponse(broker.subscribe(), media_type="text/event-stream")

    @app.post("/sessions", status_code=202, dependencies=[Depends(bearer_dependency)])
    async def start_session(body: StartSlideSessionRequest) -> dict:
        await controller.start(body.sessionId, body.imageDir, body.sourcePath, body.anchorOffsetMs)
        return {"state": "watching"}

    @app.post("/sessions/{session_id}/resume", status_code=202, dependencies=[Depends(bearer_dependency)])
    async def resume_session(session_id: str, body: ResumeSlideSessionRequest) -> dict:
        await controller.resume(session_id, body.anchorOffsetMs)
        return {"state": "watching"}

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
