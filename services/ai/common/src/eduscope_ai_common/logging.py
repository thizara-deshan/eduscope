from __future__ import annotations

import json
import logging
import sys
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

import httpx

Subservice = Literal["stt", "slide", "question"]
LogLevel = Literal["INFO", "WARN", "ERROR"]
LogCategory = Literal["Auth", "System", "Hardware", "Session"]

_SECRET_KEY_MARKERS = ("token", "secret", "password", "prompt", "transcript", "llmendpoint")
_PYTHON_LEVEL_NAMES = {"WARNING": "WARN", "INFO": "INFO", "ERROR": "ERROR", "CRITICAL": "ERROR"}


def _is_secret_shaped_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in _SECRET_KEY_MARKERS)


def _safe_context(context: Mapping[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in (context or {}).items() if not _is_secret_shaped_key(k)}


class _JsonFormatter(logging.Formatter):
    def __init__(self, subservice: Subservice) -> None:
        super().__init__()
        self._subservice = subservice

    def format(self, record: logging.LogRecord) -> str:
        context = getattr(record, "context", None)
        entry = {
            "at": datetime.now(UTC).isoformat(),
            "level": _PYTHON_LEVEL_NAMES.get(record.levelname, record.levelname),
            "service": "ai",
            "message": record.getMessage(),
            "context": {"subservice": self._subservice, **_safe_context(context)},
        }
        return json.dumps(entry, separators=(",", ":"), ensure_ascii=False)


def configure_logging(subservice: Subservice) -> logging.Logger:
    logger = logging.getLogger(f"eduscope.ai.{subservice}")
    logger.handlers.clear()
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter(subservice))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


class ProductLogError(Exception):
    pass


class ProductLogClient:
    def __init__(
        self,
        *,
        core_api_base_url: str,
        bearer_token: str,
        subservice: Subservice,
        http_client: httpx.AsyncClient,
    ) -> None:
        self._core_api_base_url = core_api_base_url.rstrip("/")
        self._bearer_token = bearer_token
        self.subservice = subservice
        self._http_client = http_client

    async def write(
        self,
        level: LogLevel,
        category: LogCategory,
        message: str,
        *,
        session_id: str | None = None,
        context: Mapping[str, Any] | None = None,
    ) -> None:
        body = {
            "level": level,
            "category": category,
            "service": "ai",
            "message": message,
            "context": {"subservice": self.subservice, **_safe_context(context)},
            "sessionId": session_id,
        }
        try:
            response = await self._http_client.post(
                f"{self._core_api_base_url}/internal/logs",
                json=body,
                headers={"Authorization": f"Bearer {self._bearer_token}"},
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ProductLogError("core-api product log sink unavailable") from exc
