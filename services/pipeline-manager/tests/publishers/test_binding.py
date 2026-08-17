from __future__ import annotations

from pipeline_manager.models import PublisherId
from pipeline_manager.publishers.base import PublisherBinding, PublisherController


def test_binding_with_credentials_is_redacted() -> None:
    binding = PublisherBinding(address="rtsp://cam1:554/stream", username="admin", password="s3cret")
    assert binding.has_secret is True
    redacted = binding.redacted()
    assert redacted.password == "<redacted>"
    assert redacted.address == binding.address
    assert redacted.username == "admin"
    # original is frozen and untouched — the real secret survives for spawn tokens
    assert binding.password == "s3cret"


def test_binding_without_secret_returns_self() -> None:
    binding = PublisherBinding(address="rtsp://cam1:554/stream")
    assert binding.has_secret is False
    assert binding.redacted() is binding


def test_bind_structured_marks_bound_and_resets_budget() -> None:
    controller = PublisherController(PublisherId.RTSP)
    assert controller.has_binding is False
    controller.restart_budget.record_attempt()
    controller.restart_budget.record_attempt()
    assert controller.restart_budget.attempts != []

    controller.bind(PublisherBinding(address="rtsp://cam1", username="u", password="p"))
    assert controller.has_binding is True
    assert isinstance(controller.binding, PublisherBinding)
    assert controller.restart_budget.attempts == []  # a binding change resets the budget


def test_bind_still_accepts_legacy_string() -> None:
    controller = PublisherController(PublisherId.RTSP)
    controller.bind("rtsp://new-camera-address")
    assert controller.has_binding is True
    assert controller.binding == "rtsp://new-camera-address"
