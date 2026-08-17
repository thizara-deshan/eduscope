from __future__ import annotations

from fastapi import FastAPI

from .config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="pipeline-manager")
    app.state.settings = settings or Settings()

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "pipeline-manager"}

    return app
