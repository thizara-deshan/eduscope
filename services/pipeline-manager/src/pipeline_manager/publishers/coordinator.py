from __future__ import annotations

import asyncio
import stat
from pathlib import Path

from ..models import PublisherId
from ..pipelines.builder import PipelineSpec, UnsupportedPipeline
from ..supervisor.health import HealthConfirmer
from ..supervisor.process import ProcessSupervisor
from ..supervisor.stop import STOP_DEADLINE_SECONDS, SignalFn, send_group_signal, stop_process
from .audio import build_audio_publisher
from .base import PUBLISHER_SOCKETS, PublisherBinding, PublisherController, PublisherEvent


def _remove_stale_socket(controller: PublisherController) -> None:
    """Remove only this fixed publisher socket when no owned child is using it.

    `shmsink` otherwise preserves the dead pathname and silently listens on a
    suffixed name (`audio.sock.0`), making status look healthy while every
    consumer still connects to the refused base path.
    """
    path = Path(PUBLISHER_SOCKETS[controller.publisher_id])
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return
    if stat.S_ISSOCK(mode):
        path.unlink()
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
    if controller.pid is not None:
        return
    controller.requested_stop = False
    try:
        _remove_stale_socket(controller)
        spec = select_publisher_spec(controller)
        process = await supervisor.start(spec, controller.identity)
        await confirmer.confirm(process, is_record=False)
    except Exception as exc:
        event = controller.on_unexpected_exit(str(exc))
        await events.publish(f"evt.pm.publisher.{event.kind}", _event_payload(event))
        return

    event = controller.mark_online(process.pid)
    await events.publish("evt.pm.publisher.running", _event_payload(event))
    controller.exit_task = asyncio.create_task(
        _watch_and_restart(controller, process, supervisor=supervisor, confirmer=confirmer, events=events)
    )


async def _watch_and_restart(controller, process, *, supervisor, confirmer, events) -> None:
    """Own the device-lifetime publisher after its initial confirmation.

    A requested stop cancels this task.  An unexpected exit affects only this
    identity, consumes the controller's bounded 1/3/8-second restart budget,
    and respawns from the current binding.  Consumers are never signalled.
    """
    current = process
    try:
        while True:
            while current.popen.poll() is None:
                # Process ownership is itself a fresh liveness observation.
                # FPS/RMS samplers may enrich these fields independently, but
                # their absence must not make a confirmed, live child stale.
                controller.observe_telemetry()
                await asyncio.sleep(0.1)
            if controller.requested_stop:
                return

            supervisor.forget(controller.identity)
            event = controller.on_unexpected_exit(f"publisher exited with status {current.popen.returncode}")
            await events.publish(f"evt.pm.publisher.{event.kind}", _event_payload(event))
            if event.backoff_seconds is None:
                return
            await asyncio.sleep(event.backoff_seconds)

            try:
                _remove_stale_socket(controller)
                spec = select_publisher_spec(controller)
                current = await supervisor.start(spec, controller.identity)
                await confirmer.confirm(current, is_record=False)
            except Exception as exc:
                failed = supervisor.processes.get(controller.identity)
                if failed is not None:
                    from ..supervisor.stop import kill_and_reap

                    await kill_and_reap(supervisor, failed)
                event = controller.on_unexpected_exit(str(exc))
                await events.publish(f"evt.pm.publisher.{event.kind}", _event_payload(event))
                if event.backoff_seconds is None:
                    return
                await asyncio.sleep(event.backoff_seconds)
                continue

            event = controller.mark_online(current.pid)
            await events.publish("evt.pm.publisher.running", _event_payload(event))
    except asyncio.CancelledError:
        return


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
    controller.requested_stop = True
    watcher = controller.exit_task
    if watcher is not None:
        watcher.cancel()
        controller.exit_task = None
    process = supervisor.processes.get(controller.identity)
    if process is None:
        return

    await stop_process(process, STOP_DEADLINE_SECONDS, send_signal=send_signal)
    supervisor.forget(controller.identity)
    _remove_stale_socket(controller)
    event = controller.mark_offline()
    await events.publish(f"evt.pm.publisher.{event.kind}", _event_payload(event))
