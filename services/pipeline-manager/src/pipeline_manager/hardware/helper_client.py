from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

CONNECT_TIMEOUT_SECONDS = 2.0
RESPONSE_TIMEOUT_SECONDS = 2.0
MAX_RESPONSE_BYTES = 16 * 1024


class LedSetArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["on", "off", "blink"]


class UsbHubCycleArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location: str = Field(pattern=r"^[0-9-]{1,32}$")
    port: int = Field(ge=1, le=32)


class HelperError(RuntimeError):
    pass


class HelperTimeout(HelperError):
    pass


class HelperResponseTooLarge(HelperError):
    pass


@dataclass(frozen=True)
class HelperResponse:
    request_id: str
    ok: bool
    error: str | None = None
    data: dict | None = None


Connector = Callable[[], Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]]


class HelperClient:
    """Schema-validated client for the fixed-verb-allowlist root helper at
    `/run/eduscope/helper.sock`. No generic `request(verb, args)` is public —
    only typed `set_led`/`cycle_usb_hub` exist, so a caller structurally
    cannot send an unknown verb or unvalidated arguments.
    """

    def __init__(
        self,
        socket_path: Path,
        *,
        connector: Connector | None = None,
        id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
        connect_timeout: float = CONNECT_TIMEOUT_SECONDS,
        response_timeout: float = RESPONSE_TIMEOUT_SECONDS,
    ) -> None:
        self._socket_path = socket_path
        self._connector = connector or self._default_connector
        self._id_factory = id_factory
        self._connect_timeout = connect_timeout
        self._response_timeout = response_timeout

    async def _default_connector(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        return await asyncio.open_unix_connection(str(self._socket_path))

    async def _send(self, verb: str, args: BaseModel) -> HelperResponse:
        request_id = self._id_factory()
        payload = json.dumps({"id": request_id, "verb": verb, "args": args.model_dump()}) + "\n"

        try:
            async with asyncio.timeout(self._connect_timeout):
                reader, writer = await self._connector()
        except TimeoutError as exc:
            raise HelperTimeout("connect timed out") from exc

        try:
            writer.write(payload.encode("utf-8"))
            await writer.drain()

            try:
                async with asyncio.timeout(self._response_timeout):
                    line = await reader.readline()
            except TimeoutError as exc:
                raise HelperTimeout("response timed out") from exc

            if len(line) > MAX_RESPONSE_BYTES:
                raise HelperResponseTooLarge(f"response exceeds {MAX_RESPONSE_BYTES} bytes")

            data = json.loads(line.decode("utf-8"))
            return HelperResponse(
                request_id=data.get("id", request_id),
                ok=bool(data.get("ok", False)),
                error=data.get("error"),
                data=data.get("data"),
            )
        finally:
            writer.close()

    async def set_led(self, mode: Literal["on", "off", "blink"]) -> HelperResponse:
        return await self._send("led.set", LedSetArgs(mode=mode))

    async def cycle_usb_hub(self, location: str, port: int) -> HelperResponse:
        return await self._send("usbhub.cycle", UsbHubCycleArgs(location=location, port=port))
