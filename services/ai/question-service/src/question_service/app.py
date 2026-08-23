from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Callable

import httpx
from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from eduscope_ai_common import configure_logging, require_bearer
from eduscope_ai_common.auth import UnauthorizedError, unauthorized_handler

from .generator import GENERATION_DEADLINE_SECONDS, GenerationError, QuestionGenerator, locate_prompt_root
from .llama import LlamaClient, LlamaError
from .models import AiProblem, GenerateRequest, GenerateResponse
from .probe import ProbeResult, probe


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EDUSCOPE_QUESTION_", extra="ignore")

    bind_host: str = "127.0.0.1"
    port: int = Field(default=7103, ge=1, le=65535)
    internal_bearer: str = Field(min_length=32)
    generation_deadline_seconds: float = Field(default=GENERATION_DEADLINE_SECONDS, gt=0)

    @field_validator("bind_host")
    @classmethod
    def localhost_only(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("question-service must bind to 127.0.0.1")
        return value


class ProbeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reachable: bool
    latencyMs: float | None
    model: str | None = None

    @classmethod
    def from_result(cls, result: ProbeResult) -> "ProbeResponse":
        return cls(reachable=result.reachable, latencyMs=result.latencyMs, model=result.model)


class QuestionServiceStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    promptVersions: list[str]
    llmEndpoint: str | None
    lastGenerationAt: datetime | None
    lastError: AiProblem | None


def _problem(code: str, title: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "title": title, "status": status})


async def _bad_request_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return _problem("bad-request", "Invalid generation request", 400)


async def _ai_problem_handler(_request: Request, exc: GenerationError | LlamaError) -> JSONResponse:
    return _problem(exc.problem.code, exc.problem.title, exc.problem.status)


def create_app(
    settings: Settings | None = None,
    *,
    llama_client: LlamaClient | None = None,
    clock: Callable[[], float] | None = None,
) -> FastAPI:
    settings = settings or Settings()
    logger = configure_logging("question")
    bearer_dependency = require_bearer(settings.internal_bearer)

    prompt_root = locate_prompt_root()

    owns_http_client = llama_client is None
    if llama_client is None:
        http_client = httpx.AsyncClient()
        llama_client = LlamaClient(http_client)
    else:
        http_client = llama_client.http_client

    generator = QuestionGenerator(
        prompt_root,
        llama_client,
        deadline_seconds=settings.generation_deadline_seconds,
        clock=clock,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("question-service ready")
        try:
            yield
        finally:
            if owns_http_client:
                await http_client.aclose()

    app = FastAPI(lifespan=lifespan)
    app.state.generator = generator
    app.state.http_client = http_client
    app.add_exception_handler(UnauthorizedError, unauthorized_handler)
    app.add_exception_handler(RequestValidationError, _bad_request_handler)
    app.add_exception_handler(GenerationError, _ai_problem_handler)
    app.add_exception_handler(LlamaError, _ai_problem_handler)

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        healthy = bool(generator.prompt_versions) and not http_client.is_closed
        if healthy:
            return JSONResponse(status_code=200, content={"status": "ok"})
        return JSONResponse(status_code=503, content={"status": "degraded"})

    @app.get("/status", dependencies=[Depends(bearer_dependency)], response_model=QuestionServiceStatus)
    async def get_status() -> QuestionServiceStatus:
        return QuestionServiceStatus(
            promptVersions=generator.prompt_versions,
            llmEndpoint=None,
            lastGenerationAt=generator.last_generation_at,
            lastError=generator.last_error,
        )

    @app.get("/probe", dependencies=[Depends(bearer_dependency)], response_model=ProbeResponse)
    async def get_probe(llmEndpoint: str = Query(...)) -> ProbeResponse:
        kwargs = {"clock": clock} if clock is not None else {}
        result = await probe(http_client, llmEndpoint, **kwargs)
        return ProbeResponse.from_result(result)

    @app.post("/generate", dependencies=[Depends(bearer_dependency)], response_model=GenerateResponse)
    async def post_generate(body: GenerateRequest) -> GenerateResponse:
        return await generator.generate(body)

    return app


def main() -> None:
    import uvicorn

    settings = Settings()
    uvicorn.run(create_app(settings), host=settings.bind_host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()
