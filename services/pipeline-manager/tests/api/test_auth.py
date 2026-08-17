from __future__ import annotations

import pytest

VALID_TOKEN = "0123456789abcdef0123456789abcdef"

ROUTES = [
    ("GET", "/status"),
    ("GET", "/sources"),
    ("GET", "/events"),
]


@pytest.mark.asyncio
async def test_healthz_is_public(client) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200


@pytest.mark.parametrize("method,path", ROUTES)
@pytest.mark.asyncio
async def test_protected_route_without_token_is_401(client, method: str, path: str) -> None:
    response = await client.request(method, path)
    assert response.status_code == 401


@pytest.mark.parametrize("method,path", ROUTES)
@pytest.mark.asyncio
async def test_protected_route_with_wrong_token_is_401(client, method: str, path: str) -> None:
    response = await client.request(method, path, headers={"Authorization": "Bearer wrong-token-wrong-token-000000"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_with_correct_token_is_not_401(client, auth_headers) -> None:
    response = await client.get("/status", headers=auth_headers)
    assert response.status_code != 401


@pytest.mark.asyncio
async def test_empty_scheme_rejected(client) -> None:
    response = await client.get("/status", headers={"Authorization": "Bearer"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_multiple_schemes_rejected(client) -> None:
    response = await client.get("/status", headers={"Authorization": f"Bearer {VALID_TOKEN}, Basic xyz"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_non_bearer_scheme_rejected(client) -> None:
    response = await client.get("/status", headers={"Authorization": f"Basic {VALID_TOKEN}"})
    assert response.status_code == 401
