from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from eduscope_ai_common.auth import UnauthorizedError, require_bearer, unauthorized_handler

TOKEN = "0123456789abcdef0123456789abcdef"

UNAUTHORIZED_PROBLEM = {"code": "unauthorized", "title": "Unauthorized", "status": 401}


def _build_app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(UnauthorizedError, unauthorized_handler)
    dependency = require_bearer(TOKEN)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/status", dependencies=[Depends(dependency)])
    async def status() -> dict[str, str]:
        return {"state": "idle"}

    return app


@pytest.fixture
def client() -> TestClient:
    return TestClient(_build_app())


def test_healthz_is_public(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200


def test_status_requires_bearer_when_missing(client: TestClient) -> None:
    response = client.get("/status")
    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED_PROBLEM


def test_status_rejects_wrong_scheme(client: TestClient) -> None:
    response = client.get("/status", headers={"Authorization": f"Basic {TOKEN}"})
    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED_PROBLEM


def test_status_rejects_empty_bearer(client: TestClient) -> None:
    response = client.get("/status", headers={"Authorization": "Bearer "})
    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED_PROBLEM


def test_status_rejects_duplicated_bearer_value(client: TestClient) -> None:
    response = client.get(
        "/status", headers={"Authorization": f"Bearer {TOKEN}, Bearer {TOKEN}"}
    )
    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED_PROBLEM


def test_status_rejects_wrong_bearer(client: TestClient) -> None:
    wrong_token = "fedcba9876543210fedcba9876543210"
    response = client.get("/status", headers={"Authorization": f"Bearer {wrong_token}"})
    assert response.status_code == 401
    assert response.json() == UNAUTHORIZED_PROBLEM


def test_status_accepts_correct_bearer(client: TestClient) -> None:
    response = client.get("/status", headers={"Authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200
    assert response.json() == {"state": "idle"}
