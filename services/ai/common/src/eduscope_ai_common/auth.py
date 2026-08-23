from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse


class UnauthorizedError(Exception):
    pass


def require_bearer(expected_token: str) -> Callable[[Request], Awaitable[None]]:
    async def dependency(request: Request) -> None:
        value = request.headers.get("authorization")
        parts = value.split(" ") if value else []
        if len(parts) != 2 or parts[0] != "Bearer" or not parts[1]:
            raise UnauthorizedError
        if not secrets.compare_digest(parts[1], expected_token):
            raise UnauthorizedError
    return dependency


async def unauthorized_handler(_request: Request, _exc: UnauthorizedError) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"code": "unauthorized", "title": "Unauthorized", "status": 401},
    )
