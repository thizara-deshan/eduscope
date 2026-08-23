from __future__ import annotations

from pathlib import Path

import yaml


def _find_openapi_yaml(start: Path) -> Path:
    current = start
    for _ in range(12):
        candidate = current / "contracts" / "openapi.yaml"
        if candidate.exists():
            return candidate
        current = current.parent
    raise FileNotFoundError(f"contracts/openapi.yaml not found above {start}")


def _load_contract() -> dict:
    path = _find_openapi_yaml(Path(__file__).resolve())
    return yaml.safe_load(path.read_text())


def test_contract_is_version_1_0_0() -> None:
    document = _load_contract()
    assert document["info"]["version"] == "1.0.0"


def test_log_entry_service_enum_contains_ai() -> None:
    document = _load_contract()
    log_entry = document["components"]["schemas"]["LogEntry"]
    assert "ai" in log_entry["properties"]["service"]["enum"]


def test_log_entry_context_describes_ai_subservice_values() -> None:
    document = _load_contract()
    log_entry = document["components"]["schemas"]["LogEntry"]
    context_description = log_entry["properties"]["context"]["description"]

    assert "context.subservice" in context_description
    for subservice in ("stt", "slide", "question"):
        assert subservice in context_description
