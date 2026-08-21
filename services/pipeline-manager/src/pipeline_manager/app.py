from __future__ import annotations

import asyncio
import itertools
import subprocess
from contextlib import asynccontextmanager, suppress
from functools import partial

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .api.events import EventBroker
from .api.problems import DomainProblem
from .api.routes import public_router, router
from .audio.control import ExecResult
from .audio.levels import AudioLevelSampler
from .config import Settings
from .consumers.base import CaptureCardRecovering, ConsumerNotRunning, PublisherNotRunning
from .consumers.projector import ProjectorConsumer
from .consumers.record import RecordConsumer
from .consumers.thumbnails import RoleNotPreviewable, ThumbnailController
from .hardware.helper_client import HelperClient
from .hardware.led import LedController
from .hardware.watchdog import CaptureCardWatchdog, ProbeResult, run_watchdog_loop
from .models import ConsumerState, PublisherId
from .pipelines.builder import UnsupportedPipeline
from .pipelines.layouts import InvalidRatio, PresetChannelMismatch
from .pipelines.live import InvalidStreamKey
from .pipelines.platforms.rk3588 import RK3588Profile
from .pipelines.preflight import as_preflight_check
from .publishers.base import ROLE_PUBLISHERS, PublisherController
from .publishers.coordinator import start_publisher as real_start_publisher
from .publishers.coordinator import stop_publisher as real_stop_publisher
from .supervisor.health import HealthConfirmer
from .supervisor.ledger import EncodeLedger, EncoderBudgetExceeded
from .supervisor.process import AdoptedPopen, ManagedProcess, ProcessSupervisor
from .supervisor.recovery import AdoptedProcess, real_expected_processes, real_proc_scanner, recover_orphans

DOMAIN_EXCEPTIONS = (
    DomainProblem,
    InvalidRatio,
    PresetChannelMismatch,
    PublisherNotRunning,
    EncoderBudgetExceeded,
    ConsumerNotRunning,
    CaptureCardRecovering,
    RoleNotPreviewable,
    UnsupportedPipeline,
    InvalidStreamKey,
    ValueError,
)


def _to_problem(exc: Exception) -> DomainProblem:
    """The one conversion point from typed domain errors to a Problem body.

    Checked most-specific first: `UnsupportedPipeline` and `InvalidStreamKey`
    are themselves `ValueError` subclasses, so the plain `ValueError` branch
    (the catch-all for `resolve_output_path` and other request-time checks)
    stays last.
    """
    if isinstance(exc, DomainProblem):
        return exc
    if isinstance(exc, InvalidRatio):
        return DomainProblem("invalid_ratio", "Ratio must be two positive integers", 400)
    if isinstance(exc, PresetChannelMismatch):
        return DomainProblem("preset_channel_mismatch", str(exc), 400)
    if isinstance(exc, PublisherNotRunning):
        publisher_id = ROLE_PUBLISHERS.get(exc.role)
        meta = {"publisherId": publisher_id.value} if publisher_id is not None else None
        return DomainProblem("publisher_not_running", "Required publisher is not running", 409, meta)
    if isinstance(exc, EncoderBudgetExceeded):
        return DomainProblem("encoder_budget_exceeded", "No free encode session", 409)
    if isinstance(exc, ConsumerNotRunning):
        return DomainProblem("consumer_not_found", str(exc), 404)
    if isinstance(exc, CaptureCardRecovering):
        return DomainProblem("capture_card_absent", "Capture card is absent or recovering", 503)
    if isinstance(exc, RoleNotPreviewable):
        return DomainProblem("publisher_not_running", str(exc), 409)
    if isinstance(exc, UnsupportedPipeline):
        return DomainProblem("unsupported_pipeline", str(exc), 400)
    if isinstance(exc, InvalidStreamKey):
        return DomainProblem("invalid_stream_key", str(exc), 400)
    if isinstance(exc, ValueError):
        return DomainProblem("invalid_output_path", str(exc), 400)
    raise exc  # pragma: no cover - defensive; every registered type is handled above


async def _domain_problem_handler(request: Request, exc: Exception) -> JSONResponse:
    problem = _to_problem(exc)
    body: dict = {"code": problem.code, "title": problem.title, "status": problem.status}
    if problem.meta:
        body["meta"] = problem.meta
    return JSONResponse(status_code=problem.status, content=body)


async def _request_validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Pydantic request-body rejections (bad types, `extra=\"forbid\"` fields,
    missing required fields) previously fell through to FastAPI's default
    `{"detail": [...]}` body — not Problem-shaped, so callers had two error
    formats to handle. Route through the same `{code, title, status}` shape.
    """
    return JSONResponse(
        status_code=422,
        content={"code": "invalid_request", "title": "Request validation failed", "status": 422},
    )


# ── lifespan seams ─────────────────────────────────────────────────────────
# Each device-touching action is an injected seam with an off-board no-op
# default; Workstream F / the board bring-up injects the real ones. This keeps
# unit tests hermetic and cross-platform while giving the lifespan real
# ordering (A-14 Step 4).


def _default_proc_scanner(pid: int):
    return None  # off-board: adopt nothing (no /proc read)


def _default_expected_processes():
    return []


async def _noop_start_publisher(controller) -> None:
    return None  # off-board: real GStreamer spawn is board bring-up (Workstream F)


async def _noop_stop_publisher(controller) -> None:
    return None  # off-board: nothing was ever spawned, so there is nothing to signal


async def _no_preflight_source():
    return None  # off-board: gst-inspect is board-only, so preflight stays unset


def _reconstruct_adopted_record(state, adopted: AdoptedProcess) -> RecordConsumer:
    """Rebuild a `RecordConsumer` around a live pid this instance never
    spawned (A-REV-007): same collaborators `start_record` would inject, but
    ownership is attached directly rather than driven through `.start()` —
    there is no `PipelineSpec` to re-confirm against, only a process already
    running. `AdoptedPopen` stands in for the real `subprocess.Popen` handle
    we can never have for a non-child pid. The encode-ledger reservation this
    process would have held is not retroactively reclaimed here — it was
    never released either, so a hardware encoder slot can go untracked until
    this record is stopped; acceptable for a conservative recovery path with
    no persisted domain state to size the reservation from.
    """
    consumer = RecordConsumer(
        adopted.identity,
        supervisor=state.supervisor,
        ledger=state.ledger,
        confirmer=state.confirmer,
        platform=state.platform,
        is_publisher_running=state.is_publisher_running,
        is_capture_card_recovering=state.is_capture_card_recovering,
        events=state.events,
    )
    process = ManagedProcess(
        identity=adopted.identity, pid=adopted.pid, pgid=adopted.pgid, popen=AdoptedPopen(adopted.pid)
    )
    state.supervisor.processes[adopted.identity] = process
    consumer.process = process
    consumer.pgid = adopted.pgid
    consumer.output_path = adopted.output_path
    consumer.state = ConsumerState.RUNNING
    consumer.adopted = True
    consumer._start_exit_watcher(process)
    return consumer


async def _run_startup(app: FastAPI) -> None:
    """construct state → recover exact orphans → (boot preflight) → start bound
    publishers/watchdog → serve (A-14 Step 4). Every step is a no-op off-board
    by default; injected seams make each observable in tests and real on board.
    """
    state = app.state
    # 1. Conservative orphan adoption (empty off-board: no sidecars, scanner→None).
    state.recovery = recover_orphans(
        state.expected_processes(),
        state.runtime_dir,
        proc_scanner=state.proc_scanner,
    )
    # 1b. Reconstruct ownership of every adopted *record* — the only kind
    # core-api expects to survive a manager restart untouched.
    for adopted in state.recovery.adopted:
        if adopted.kind != "record":
            continue
        state.consumers[adopted.identity] = _reconstruct_adopted_record(state, adopted)
    # 2. Boot-time preflight gate (board-only; None off-board leaves it unset).
    report = await state.preflight_source()
    if report is not None:
        state.preflight_check = as_preflight_check(report)
    # 3. Bring up publishers that already hold a valid binding.
    for controller in state.publishers.values():
        if controller.has_binding:
            await state.start_publisher(controller)
    # 4. Start the capture-card watchdog probe loop.
    state.watchdog_task = asyncio.create_task(run_watchdog_loop(state.watchdog))


async def _run_shutdown(app: FastAPI) -> None:
    """Stop the watchdog and auxiliary/channel/display children; leave an
    actively adopted record untouched for core-api recovery policy; close
    preview negotiations and flush ownership sidecars."""
    state = app.state
    task = getattr(state, "watchdog_task", None)
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        state.watchdog_task = None

    for consumer_id in list(state.consumers):
        consumer = state.consumers.get(consumer_id)
        if getattr(consumer, "adopted", False):
            continue  # actively adopted record: left running for core-api recovery
        consumer = state.consumers.pop(consumer_id, None)
        if consumer is None:
            continue
        with suppress(Exception):
            await consumer.stop()

    projector = getattr(state, "projector", None)
    if projector is not None and getattr(projector, "process", None) is not None:
        with suppress(Exception):
            await projector.stop()

    for negotiation_id in list(state.thumbnails.negotiations):
        await state.thumbnails.close(negotiation_id)

    state.flush_sidecars()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _run_startup(app)
    try:
        yield
    finally:
        await _run_shutdown(app)


def create_app(settings: Settings | None = None, *, popen=None, runtime_dir=None) -> FastAPI:
    """`runtime_dir` opts the supervisor into real sidecar I/O (A-REV-007);
    left `None` (every caller except `create_production_app`, and every
    existing unit/HTTP-level test) it stays the hermetic default — a fake
    `popen` redirecting to a real subprocess for Integ-A coverage does not,
    by itself, imply writing to a real filesystem location.
    """
    app = FastAPI(title="pipeline-manager", lifespan=lifespan)
    settings = settings or Settings()
    app.state.settings = settings

    for exc_type in DOMAIN_EXCEPTIONS:
        app.add_exception_handler(exc_type, _domain_problem_handler)
    app.add_exception_handler(RequestValidationError, _request_validation_handler)

    app.state.platform = RK3588Profile()
    app.state.supervisor = (
        ProcessSupervisor(popen=popen, runtime_dir=runtime_dir) if popen is not None else ProcessSupervisor()
    )
    app.state.ledger = EncodeLedger()
    app.state.confirmer = HealthConfirmer()
    app.state.events = EventBroker(
        replay_size=settings.event_replay_size,
        subscriber_queue_size=settings.event_subscriber_queue_size,
    )

    app.state.publishers = {pid: PublisherController(pid) for pid in PublisherId}
    # One lock per publisher identity so a start/stop command dispatched from
    # a route (§3.1: 202-then-event) never races a concurrent command on the
    # same publisher; unrelated publishers never block each other.
    app.state.publisher_locks = {pid: asyncio.Lock() for pid in PublisherId}
    app.state.consumers = {}

    def is_publisher_running(role) -> bool:
        publisher_id = ROLE_PUBLISHERS.get(role)
        if publisher_id is None:
            return False
        return app.state.publishers[publisher_id].current_state().value in ("online", "degraded")

    app.state.is_publisher_running = is_publisher_running
    app.state.is_capture_card_recovering = lambda: app.state.watchdog.state == "recovering"
    app.state.has_ai_subscription = lambda: True
    # Injected by tests / wired to a real PreflightRunner call later; None skips the check.
    app.state.preflight_check = None

    # Lifespan seams (A-14 Step 4). Off-board no-op defaults; board bring-up
    # (Workstream F) injects real orphan scanning, publisher spawn, and preflight.
    app.state.runtime_dir = settings.runtime_dir
    app.state.proc_scanner = _default_proc_scanner
    app.state.expected_processes = _default_expected_processes
    app.state.start_publisher = _noop_start_publisher
    app.state.stop_publisher = _noop_stop_publisher
    app.state.preflight_source = _no_preflight_source
    app.state.flush_sidecars = lambda: None
    app.state.watchdog_task = None
    app.state.recovery = None

    id_counter = itertools.count(1)
    app.state.new_id = lambda: f"{next(id_counter):08d}"

    app.state.helper = HelperClient(settings.helper_socket)
    app.state.led = LedController(app.state.helper, present=settings.led_present)

    async def _default_probe() -> ProbeResult:
        return ProbeResult(returncode=1, stdout="")

    app.state.watchdog = CaptureCardWatchdog(
        stable_identifier=settings.capture_card_stable_identifier,
        hub_location=settings.capture_card_hub_location,
        hub_port=settings.capture_card_hub_port,
        helper=app.state.helper,
        probe=_default_probe,
    )

    app.state.projector = ProjectorConsumer(
        "projector:main",
        platform=app.state.platform,
        precondition_holds=lambda: True,
        supervisor=app.state.supervisor,
        ledger=app.state.ledger,
        confirmer=app.state.confirmer,
        events=app.state.events,
    )
    app.state.thumbnails = ThumbnailController(
        supervisor=app.state.supervisor,
        ledger=app.state.ledger,
        events=app.state.events,
        platform=app.state.platform,
        is_role_online_and_bound=is_publisher_running,
    )

    async def _default_audio_exec(argv) -> ExecResult:
        return ExecResult(returncode=1, stderr="amixer not available on this host")

    app.state.audio_exec = _default_audio_exec
    app.state.audio_sampler = AudioLevelSampler(read_rms=lambda: 0.0)
    app.state.audio_subscriptions = {}

    app.include_router(public_router)
    app.include_router(router)

    return app


def create_production_app(settings: Settings | None = None) -> FastAPI:
    """The real Uvicorn entrypoint (A-REV-001/A-REV-011/A-REV-007): injects a
    real `Popen`, the real `start_publisher`/`stop_publisher` coordinators,
    and the real sidecar/`proc` adapters behind `create_app`'s seams.

    The remaining seams (`preflight_source`, `audio_exec`, `watchdog.probe`)
    stay the hermetic no-op defaults `create_app` sets until their own
    batches (B6) add real adapters for them — this factory grows
    incrementally with the remediation plan, it does not jump ahead of it.
    """
    settings = settings or Settings()
    app = create_app(settings, popen=subprocess.Popen, runtime_dir=settings.runtime_dir)
    app.state.start_publisher = partial(
        real_start_publisher,
        supervisor=app.state.supervisor,
        confirmer=app.state.confirmer,
        events=app.state.events,
    )
    app.state.stop_publisher = partial(
        real_stop_publisher,
        supervisor=app.state.supervisor,
        events=app.state.events,
    )
    app.state.proc_scanner = real_proc_scanner
    app.state.expected_processes = partial(real_expected_processes, settings.runtime_dir)
    return app
