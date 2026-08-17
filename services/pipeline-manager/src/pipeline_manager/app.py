from __future__ import annotations

import itertools

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api.events import EventBroker
from .api.problems import DomainProblem
from .api.routes import public_router, router
from .audio.control import ExecResult
from .audio.levels import AudioLevelSampler
from .config import Settings
from .consumers.base import CaptureCardRecovering, ConsumerNotRunning, PublisherNotRunning
from .consumers.projector import ProjectorConsumer
from .consumers.thumbnails import RoleNotPreviewable, ThumbnailController
from .hardware.helper_client import HelperClient
from .hardware.led import LedController
from .hardware.watchdog import CaptureCardWatchdog, ProbeResult
from .models import PublisherId
from .pipelines.layouts import InvalidRatio, PresetChannelMismatch
from .pipelines.platforms.rk3588 import RK3588Profile
from .publishers.base import ROLE_PUBLISHERS, PublisherController
from .supervisor.health import HealthConfirmer
from .supervisor.ledger import EncodeLedger, EncoderBudgetExceeded
from .supervisor.process import ProcessSupervisor

DOMAIN_EXCEPTIONS = (
    DomainProblem,
    InvalidRatio,
    PresetChannelMismatch,
    PublisherNotRunning,
    EncoderBudgetExceeded,
    ConsumerNotRunning,
    CaptureCardRecovering,
    RoleNotPreviewable,
)


def _to_problem(exc: Exception) -> DomainProblem:
    """The one conversion point from typed domain errors to a Problem body."""
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
    raise exc  # pragma: no cover - defensive; every registered type is handled above


async def _domain_problem_handler(request: Request, exc: Exception) -> JSONResponse:
    problem = _to_problem(exc)
    body: dict = {"code": problem.code, "title": problem.title, "status": problem.status}
    if problem.meta:
        body["meta"] = problem.meta
    return JSONResponse(status_code=problem.status, content=body)


def create_app(settings: Settings | None = None, *, popen=None) -> FastAPI:
    app = FastAPI(title="pipeline-manager")
    settings = settings or Settings()
    app.state.settings = settings

    for exc_type in DOMAIN_EXCEPTIONS:
        app.add_exception_handler(exc_type, _domain_problem_handler)

    app.state.platform = RK3588Profile()
    app.state.supervisor = ProcessSupervisor(popen=popen) if popen is not None else ProcessSupervisor()
    app.state.ledger = EncodeLedger()
    app.state.confirmer = HealthConfirmer()
    app.state.events = EventBroker(
        replay_size=settings.event_replay_size,
        subscriber_queue_size=settings.event_subscriber_queue_size,
    )

    app.state.publishers = {pid: PublisherController(pid) for pid in PublisherId}
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
    )
    app.state.thumbnails = ThumbnailController(
        supervisor=app.state.supervisor,
        ledger=app.state.ledger,
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
