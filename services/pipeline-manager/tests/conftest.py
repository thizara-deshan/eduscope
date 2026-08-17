from __future__ import annotations

from pathlib import Path

import pytest
import yaml

CONTRACT_PATH = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"


@pytest.fixture(scope="session")
def contract() -> dict:
    with CONTRACT_PATH.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


@pytest.fixture
def valid_token() -> str:
    return "0123456789abcdef0123456789abcdef"
