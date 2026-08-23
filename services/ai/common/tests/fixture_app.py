from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse

from eduscope_ai_common import SseBroker, configure_logging, require_bearer
from eduscope_ai_common.auth import UnauthorizedError, unauthorized_handler

HEARTBEAT_INTERVAL_SECONDS = 0.5


def create_app(*, expected_token: str | None = None) -> FastAPI:
    token = expected_token or os.environ["EDUSCOPE_AI_INTERNAL_BEARER"]
    logger = configure_logging("stt")
    broker = SseBroker()
    bearer_dependency = require_bearer(token)

    async def heartbeat() -> None:
        sequence = 0
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            sequence += 1
            broker.publish("evt.fixture.heartbeat", {"sequence": sequence})

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("ai fixture service ready")
        task = asyncio.create_task(heartbeat())
        try:
            yield
        finally:
            task.cancel()

    app = FastAPI(lifespan=lifespan)
    app.add_exception_handler(UnauthorizedError, unauthorized_handler)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/status", dependencies=[Depends(bearer_dependency)])
    async def status() -> dict[str, str]:
        return {"state": "idle"}

    @app.get("/events", dependencies=[Depends(bearer_dependency)])
    async def events() -> StreamingResponse:
        return StreamingResponse(broker.subscribe(), media_type="text/event-stream")

    return app


app = create_app()
