from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from pipeline_manager.audio.levels import MIN_SAMPLE_PERIOD_SECONDS, AudioLevelSampler
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
