from __future__ import annotations

import secrets

from fastapi import HTTPException, Request


def _extract_bearer_token(header_value: str | None) -> str | None:
    """Rejects missing/empty/multiple schemes — only exactly `Bearer <token>`."""
    if not header_value:
        return None
    parts = header_value.split(" ")
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme != "Bearer" or not token:
        return None
    return token


async def require_bearer(request: Request) -> None:
    settings = request.app.state.settings
    token = _extract_bearer_token(request.headers.get("authorization"))
    if token is None or not secrets.compare_digest(token, settings.shared_bearer_token):
        raise HTTPException(status_code=401, detail="unauthorized")
