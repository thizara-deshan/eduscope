from __future__ import annotations

from ..models import PublisherId
from ..pipelines.builder import PipelineSpec, UnsupportedPipeline
from ..supervisor.health import HealthConfirmer
from ..supervisor.process import ProcessSupervisor
from ..supervisor.stop import STOP_DEADLINE_SECONDS, SignalFn, send_group_signal, stop_process
from .audio import build_audio_publisher
from .base import PublisherBinding, PublisherController, PublisherEvent
from .rtsp import RtspCredentials, build_rtsp_publisher
from .usb import build_usb_publisher


class PublisherNotBound(RuntimeError):
    def __init__(self, publisher_id: PublisherId) -> None:
        super().__init__(f"{publisher_id.value} has no binding")
        self.publisher_id = publisher_id


def select_publisher_spec(controller: PublisherController) -> PipelineSpec:
    """Choose the USB/RTSP/audio builder for `controller`'s current binding
    (Tier-1, pure) — the one decision point `start_publisher` needs before it
    can hand argv to the supervisor. `address` is the generic "where to find
    the source" string (RTSP URL, ALSA device id, or a v4l2 device path);
    `device_path` is USB-specific and wins over `address` when both are set.
    """
    binding = controller.binding
    if binding is None:
        raise PublisherNotBound(controller.publisher_id)

    address = binding.address if isinstance(binding, PublisherBinding) else binding
    device_path = binding.device_path if isinstance(binding, PublisherBinding) else None

    if controller.publisher_id is PublisherId.USB:
        return build_usb_publisher(device_path or address)

    if controller.publisher_id in (PublisherId.RTSP, PublisherId.RTSP2):
        credentials = None
        if isinstance(binding, PublisherBinding) and binding.username and binding.password:
            credentials = RtspCredentials(username=binding.username, password=binding.password)
        return build_rtsp_publisher(controller.publisher_id, address, credentials)

    if controller.publisher_id is PublisherId.AUDIO:
        return build_audio_publisher(address)

    raise UnsupportedPipeline(f"no publisher builder for {controller.publisher_id.value}")  # pragma: no cover - exhaustive over PublisherId


def _event_payload(event: PublisherEvent) -> dict:
    """The `evt.pm.publisher.*` data shape (tests/fixtures/events/publisher.json
    — the contract this coordinator must match)."""
    return {
        "publisherId": event.publisher_id.value,
        "roleId": event.role_id.value,
        "state": event.state.value,
        "fps": event.fps,
        "rms": event.rms,
        "lastError": event.last_error,
    }


async def start_publisher(
    controller: PublisherController,
    *,
    supervisor: ProcessSupervisor,
    confirmer: HealthConfirmer,
    events,
) -> None:
    """Bind -> build -> spawn -> confirm -> mark online -> publish (A-REV-001).

    Never raises: the HTTP route has already returned 202 by the time this
    runs, so every outcome — including "no binding yet" — is reported only
    through `evt.pm.publisher.*` / `GET /status`. Cleanup of a process that
    spawned but failed confirmation (killing the zombie child) is B3's
    failed-start-cleanup finding, not this coordinator's job.
    """
    try:
        spec = select_publisher_spec(controller)
        process = await supervisor.start(spec, controller.identity)
        await confirmer.confirm(process, is_record=False)
    except Exception as exc:
        event = controller.on_unexpected_exit(str(exc))
        await events.publish(f"evt.pm.publisher.{event.kind}", _event_payload(event))
        return

    event = controller.mark_online(process.pid)
    await events.publish("evt.pm.publisher.running", _event_payload(event))


async def stop_publisher(
    controller: PublisherController,
    *,
    supervisor: ProcessSupervisor,
    events,
    send_signal: SignalFn = send_group_signal,
) -> None:
    """Idempotent: stopping a publisher with nothing running is a no-op —
    the same "stop before/after it's actually running" shape the consumer
    stop path already handles (`ConsumerController.stop`)."""
    process = supervisor.processes.get(controller.identity)
    if process is None:
        return

    await stop_process(process, STOP_DEADLINE_SECONDS, send_signal=send_signal)
    supervisor.processes.pop(controller.identity, None)
    event = controller.mark_offline()
    await events.publish(f"evt.pm.publisher.{event.kind}", _event_payload(event))
