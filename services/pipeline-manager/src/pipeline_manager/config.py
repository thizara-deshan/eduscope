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

    @field_validator("bind_host")
    @classmethod
    def localhost_only(cls, value: str) -> str:
        if value != "127.0.0.1":
            raise ValueError("pipeline-manager must bind to 127.0.0.1")
        return value
