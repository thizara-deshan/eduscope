from __future__ import annotations

import httpx
import pytest
from pydantic import ValidationError

from pipeline_manager.app import create_app
from pipeline_manager.config import Settings


@pytest.mark.asyncio
async def test_healthz_is_public_and_ok(valid_token: str) -> None:
    app = create_app(Settings(shared_bearer_token=valid_token))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "pipeline-manager"}


def test_public_bind_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(bind_host="0.0.0.0")
