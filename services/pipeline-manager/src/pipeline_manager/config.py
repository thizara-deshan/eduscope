from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EDUSCOPE_PM_", extra="ignore")

    bind_host: str = "127.0.0.1"
    port: int = Field(default=8091, ge=1, le=65535)
    platform_id: Literal["rk3588"] = "rk3588"
    shared_bearer_token: str = Field(min_length=32)
    recordings_root: Path = Path("/media/eduscope/recordings")
    helper_socket: Path = Path("/run/eduscope/helper.sock")
    event_replay_size: int = Field(default=512, ge=32, le=4096)
    event_subscriber_queue_size: int = Field(default=100, ge=8, le=4096)

    mic_alsa_card: str = "1"
    mic_alsa_control: str = "Mic"
    mic_mixer_min: int = 0
    mic_mixer_max: int = 100
    hdmi2_alsa_device: str = "hw:2,0"

    capture_card_stable_identifier: str = "eduscope-capture-dongle"
    capture_card_hub_location: str = "1-2"
    capture_card_hub_port: int = Field(default=3, ge=1, le=32)
    led_present: bool = True

    @field_validator("bind_host")
    @classmethod
    def localhost_only(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("pipeline-manager must bind to 127.0.0.1")
        return value
