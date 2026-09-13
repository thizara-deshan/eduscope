from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from pipeline_manager.audio.levels import (
    MIN_SAMPLE_PERIOD_SECONDS,
    AudioLevelSampler,
    GstLevelMeterTap,
    _parse_latest_rms,
    _rms_db_to_linear,
    build_level_tap_argv,
)
from pipeline_manager.models import SourceRole

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "events" / "audio-levels.json"


class FakeAsyncClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds
        await asyncio.sleep(0)  # yield control once so other tasks can run


def test_min_sample_period_caps_at_ten_hz() -> None:
    assert MIN_SAMPLE_PERIOD_SECONDS == 0.1


@pytest.mark.asyncio
async def test_zero_subscribers_means_zero_samples() -> None:
    sampler = AudioLevelSampler(read_rms=lambda: 0.5)
    await asyncio.sleep(0.05)
    assert sampler.emitted == []
    assert sampler.subscriber_count == 0


@pytest.mark.asyncio
async def test_rms_is_normalized_0_to_1() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(read_rms=lambda: 2.5, clock=fake.clock, sleep=fake.sleep)  # out-of-range input
    async with sampler:
        for _ in range(3):
            await asyncio.sleep(0)
    assert sampler.emitted
    assert all(0.0 <= sample.rms <= 1.0 for sample in sampler.emitted)


@pytest.mark.asyncio
async def test_starts_sampling_when_subscriber_count_goes_zero_to_one() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(read_rms=lambda: 0.3, clock=fake.clock, sleep=fake.sleep)
    assert sampler.subscriber_count == 0
    async with sampler:
        assert sampler.subscriber_count == 1
        await asyncio.sleep(0)
        assert len(sampler.emitted) >= 1


@pytest.mark.asyncio
async def test_stops_sampling_when_subscriber_count_goes_one_to_zero() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(read_rms=lambda: 0.3, clock=fake.clock, sleep=fake.sleep)
    async with sampler:
        await asyncio.sleep(0)
    assert sampler.subscriber_count == 0
    count_after_exit = len(sampler.emitted)
    await asyncio.sleep(0.02)
    assert len(sampler.emitted) == count_after_exit  # no further emits


@pytest.mark.asyncio
async def test_at_most_ten_events_per_second_under_fake_time() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(read_rms=lambda: 0.4, clock=fake.clock, sleep=fake.sleep)
    async with sampler:
        # Drive 1.0s of fake time forward through many quick loop turns.
        for _ in range(400):
            await asyncio.sleep(0)
            if fake.now >= 1.0:
                break
    assert len(sampler.emitted) <= 11  # <=10 Hz, +1 for the immediate first sample


@pytest.mark.asyncio
async def test_role_is_mic_lecturer() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(read_rms=lambda: 0.1, clock=fake.clock, sleep=fake.sleep)
    async with sampler:
        await asyncio.sleep(0)
    assert sampler.emitted[0].role_id is SourceRole.MIC_LECTURER


@pytest.mark.asyncio
async def test_sampler_can_emit_mic_room_role() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(
        read_rms=lambda: 0.2, role=SourceRole.MIC_ROOM,
        clock=fake.clock, sleep=fake.sleep,
    )
    async with sampler:
        await asyncio.sleep(0)
    assert sampler.emitted[0].role_id is SourceRole.MIC_ROOM


@pytest.mark.asyncio
async def test_does_not_open_a_second_capture_device() -> None:
    """The sampler only ever calls the injected read_rms tap — proven by the
    fact its constructor takes no device/card argument at all."""
    import inspect

    signature = inspect.signature(AudioLevelSampler.__init__)
    assert "device" not in signature.parameters
    assert "card" not in signature.parameters


def test_fixture_rms_values_are_normalized() -> None:
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for row in rows:
        assert 0.0 <= row["rms"] <= 1.0
        assert row["roleId"] == "mic-lecturer"


# ── drain (A-REV-012: shutdown must not leak the sampler's background task) ─


@pytest.mark.asyncio
async def test_drain_stops_the_task_and_zeroes_subscribers() -> None:
    fake = FakeAsyncClock()
    sampler = AudioLevelSampler(read_rms=lambda: 0.3, clock=fake.clock, sleep=fake.sleep)
    await sampler.__aenter__()
    await sampler.__aenter__()  # two open subscriptions, like two HTTP subscribers
    assert sampler.subscriber_count == 2

    await sampler.drain()

    assert sampler.subscriber_count == 0
    count_after_drain = len(sampler.emitted)
    await asyncio.sleep(0.02)
    assert len(sampler.emitted) == count_after_drain  # task is actually gone, not just decremented


@pytest.mark.asyncio
async def test_drain_with_zero_subscribers_is_a_noop() -> None:
    sampler = AudioLevelSampler(read_rms=lambda: 0.3)
    await sampler.drain()  # must not raise
    assert sampler.subscriber_count == 0


# ── GstLevelMeterTap (A-REV-012: real read_rms source) ──────────────────────


def test_build_level_tap_argv_taps_the_existing_shm_socket_not_alsa() -> None:
    argv = build_level_tap_argv("/tmp/audio.sock")
    assert "shmsrc" in argv
    assert "socket-path=/tmp/audio.sock" in argv
    assert "level" in argv
    assert "alsasrc" not in argv  # never a second ALSA capture device


def test_build_level_tap_argv_uses_a_bounded_interval() -> None:
    argv = build_level_tap_argv("/tmp/audio.sock", interval_ns=200_000_000)
    assert "interval=200000000" in argv


@pytest.mark.parametrize(
    "db,expected",
    [(0.0, 1.0), (-100.0, pytest.approx(1e-5, rel=1e-4)), (-6.0, pytest.approx(0.501187, rel=1e-4))],
)
def test_rms_db_to_linear_conversion(db: float, expected) -> None:
    assert _rms_db_to_linear(db) == expected


def test_rms_db_to_linear_clamps_above_zero_db() -> None:
    assert _rms_db_to_linear(20.0) == 1.0  # a post-clip signal never reports > 1.0


@pytest.mark.parametrize(
    "line,expected_db",
    [
        (b"level, rms=(float){ -20.0, -21.0 };", -20.0),
        (b"level, rms=(double){ -12.5, -13.0 };", -12.5),
        (b"level, rms=< (double)-6.0, (double)-6.5 >;", -6.0),
        # The serialization emitted by GStreamer on the production hardware.
        (b"level, rms=(GValueArray)< -55.769339481943973, -55.697036148670939 >;", -55.769339481943973),
        (b"level, peak=(float){ -1.0 };", None),
    ],
)
def test_parse_latest_rms_handles_both_forms(line: bytes, expected_db: float | None) -> None:
    assert _parse_latest_rms(line) == expected_db


@dataclass
class FakeStdout:
    lines: list[bytes] = field(default_factory=list)

    async def readline(self) -> bytes:
        if not self.lines:
            return b""
        return self.lines.pop(0)


@dataclass
class FakeProcess:
    stdout: FakeStdout
    terminated: bool = False
    waited: bool = False

    def terminate(self) -> None:
        self.terminated = True

    async def wait(self) -> int:
        self.waited = True
        return 0


@pytest.mark.asyncio
async def test_meter_tap_parses_rms_from_level_bus_lines() -> None:
    level_line = (
        b"0:00:01.234567890 /GstPipeline:pipeline0/GstLevel:level0.GstPad:src: "
        b"rms=(float){ -12.5 };\n"
    )
    process = FakeProcess(stdout=FakeStdout(lines=[level_line]))

    async def fake_spawn(argv):
        return process

    tap = GstLevelMeterTap("/tmp/audio.sock", spawn=fake_spawn)
    assert tap.read_rms() == 0.0  # nothing observed yet
    await tap.start()
    # Let the reader task actually consume the queued line.
    for _ in range(20):
        await asyncio.sleep(0)
        if tap.read_rms() != 0.0:
            break
    assert tap.read_rms() == _rms_db_to_linear(-12.5)
    await tap.stop()
    assert process.terminated is True
    assert process.waited is True


def test_meter_tap_maps_named_publisher_levels_to_roles() -> None:
    tap = GstLevelMeterTap("/tmp/audio.sock")
    tap.observe_line(
        b'Got message from element "lvl_mic_lecturer" (element): '
        b'level, rms=(GValueArray)< -12.0, -13.0 >;'
    )
    tap.observe_line(
        b'/GstPipeline:pipeline0/GstLevel:lvl_mic_room: '
        b'level, rms=(double){ -20.0, -21.0 };'
    )
    assert tap.read_rms(SourceRole.MIC_LECTURER) == _rms_db_to_linear(-12.0)
    assert tap.read_rms(SourceRole.MIC_ROOM) == _rms_db_to_linear(-20.0)


@pytest.mark.asyncio
async def test_meter_tap_start_is_idempotent() -> None:
    process = FakeProcess(stdout=FakeStdout(lines=[]))
    spawn_calls = []

    async def fake_spawn(argv):
        spawn_calls.append(argv)
        return process

    tap = GstLevelMeterTap("/tmp/audio.sock", spawn=fake_spawn)
    await tap.start()
    await tap.start()
    assert len(spawn_calls) == 1
    await tap.stop()


@pytest.mark.asyncio
async def test_meter_tap_reconnects_when_audio_publisher_replaces_socket() -> None:
    """Core may rebind/restart the publisher after PM startup.  The shm reader
    reaches EOF when that happens and must attach to the replacement socket."""
    first = FakeProcess(stdout=FakeStdout(lines=[]))
    second = FakeProcess(
        stdout=FakeStdout(lines=[b"level, rms=(GValueArray)< -20.0, -21.0 >;\n"])
    )
    processes = [first, second]
    spawn_calls = []

    async def fake_spawn(argv):
        spawn_calls.append(argv)
        return processes[min(len(spawn_calls) - 1, 1)]

    tap = GstLevelMeterTap("/tmp/audio.sock", spawn=fake_spawn, reconnect_delay=0)
    await tap.start()
    for _ in range(20):
        await asyncio.sleep(0)
        if tap.read_rms() != 0.0:
            break

    assert len(spawn_calls) >= 2
    assert tap.read_rms() == _rms_db_to_linear(-20.0)
    await tap.stop()


@pytest.mark.asyncio
async def test_meter_tap_stop_without_start_does_not_raise() -> None:
    tap = GstLevelMeterTap("/tmp/audio.sock", spawn=lambda argv: None)
    await tap.stop()
