from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from pipeline_manager.hardware.helper_client import (
    HelperClient,
    HelperResponseTooLarge,
    HelperTimeout,
    LedSetArgs,
    UsbHubCycleArgs,
)

from .fake_helper import FakeHelperServer


class FakeStreamWriter:
    def __init__(self) -> None:
        self.written = b""
        self.closed = False

    def write(self, data: bytes) -> None:
        self.written += data

    async def drain(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True


class FakeStreamReader:
    def __init__(self, line: bytes) -> None:
        self._line = line

    async def readline(self) -> bytes:
        return self._line


def _connector_returning(response: dict):
    line = (json.dumps(response) + "\n").encode("utf-8")
    reader = FakeStreamReader(line)
    writer = FakeStreamWriter()

    async def connector():
        return reader, writer

    return connector, reader, writer


def _hanging_connector():
    async def connector():
        await asyncio.sleep(10)
        raise AssertionError("should have timed out first")

    return connector


class TestArgsValidation:
    def test_led_set_accepts_known_modes(self) -> None:
        for mode in ("on", "off", "blink"):
            LedSetArgs(mode=mode)

    def test_led_set_rejects_unknown_mode(self) -> None:
        with pytest.raises(ValidationError):
            LedSetArgs(mode="strobe")

    def test_led_set_rejects_extra_args(self) -> None:
        with pytest.raises(ValidationError):
            LedSetArgs(mode="on", extra="nope")

    def test_usbhub_cycle_rejects_extra_args(self) -> None:
        with pytest.raises(ValidationError):
            UsbHubCycleArgs(location="1-2", port=3, extra="nope")

    def test_usbhub_cycle_rejects_bad_location_pattern(self) -> None:
        with pytest.raises(ValidationError):
            UsbHubCycleArgs(location="1-2; rm -rf", port=3)

    def test_usbhub_cycle_rejects_out_of_range_port(self) -> None:
        with pytest.raises(ValidationError):
            UsbHubCycleArgs(location="1-2", port=99)


class TestNoGenericRequestMethod:
    def test_only_set_led_and_cycle_usb_hub_are_public(self) -> None:
        public_methods = {name for name in dir(HelperClient) if not name.startswith("_")}
        assert public_methods == {"set_led", "cycle_usb_hub"}


@pytest.mark.asyncio
async def test_set_led_sends_verb_and_mode_and_propagates_request_id() -> None:
    connector, reader, writer = _connector_returning({"id": "will-be-overwritten", "ok": True})
    client = HelperClient(Path("/run/eduscope/helper.sock"), connector=connector, id_factory=lambda: "req-1")

    response = await client.set_led("blink")

    sent = json.loads(writer.written.decode("utf-8"))
    assert sent["verb"] == "led.set"
    assert sent["args"] == {"mode": "blink"}
    assert sent["id"] == "req-1"
    assert response.ok is True


@pytest.mark.asyncio
async def test_cycle_usb_hub_sends_verb_and_args() -> None:
    connector, reader, writer = _connector_returning({"id": "req-2", "ok": True})
    client = HelperClient(Path("/run/eduscope/helper.sock"), connector=connector, id_factory=lambda: "req-2")

    await client.cycle_usb_hub("1-2", 3)

    sent = json.loads(writer.written.decode("utf-8"))
    assert sent["verb"] == "usbhub.cycle"
    assert sent["args"] == {"location": "1-2", "port": 3}


@pytest.mark.asyncio
async def test_connect_timeout_raises_helper_timeout() -> None:
    client = HelperClient(
        Path("/run/eduscope/helper.sock"), connector=_hanging_connector(), connect_timeout=0.05
    )
    with pytest.raises(HelperTimeout):
        await client.set_led("on")


@pytest.mark.asyncio
async def test_response_timeout_raises_helper_timeout() -> None:
    class HangingReader:
        async def readline(self):
            await asyncio.sleep(10)
            return b""

    async def connector():
        return HangingReader(), FakeStreamWriter()

    client = HelperClient(Path("/run/eduscope/helper.sock"), connector=connector, response_timeout=0.05)
    with pytest.raises(HelperTimeout):
        await client.set_led("on")


@pytest.mark.asyncio
async def test_oversize_response_is_rejected() -> None:
    huge = {"id": "req-3", "ok": True, "data": {"padding": "x" * (17 * 1024)}}
    connector, _, _ = _connector_returning(huge)
    client = HelperClient(Path("/run/eduscope/helper.sock"), connector=connector)
    with pytest.raises(HelperResponseTooLarge):
        await client.set_led("on")


@pytest.mark.asyncio
async def test_writer_is_always_closed() -> None:
    connector, _, writer = _connector_returning({"id": "req-4", "ok": True})
    client = HelperClient(Path("/run/eduscope/helper.sock"), connector=connector)
    await client.set_led("on")
    assert writer.closed is True


# ── real Unix-domain-socket integration test (POSIX only) ──────────────────


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="AF_UNIX asyncio support is POSIX-only on this Python; verified on target")
async def test_real_unix_socket_roundtrip(tmp_path: Path) -> None:
    socket_path = tmp_path / "helper.sock"
    server = FakeHelperServer(socket_path)
    await server.start()
    try:
        client = HelperClient(socket_path)
        response = await client.set_led("blink")
        assert response.ok is True
        sent = json.loads(server.received_lines[0])
        assert sent["verb"] == "led.set"
        assert sent["args"] == {"mode": "blink"}
    finally:
        await server.stop()
