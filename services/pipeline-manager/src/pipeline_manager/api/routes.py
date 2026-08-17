from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import Response

from ..consumers.base import ConsumerNotRunning
from ..consumers.live import LiveConsumer
from ..consumers.meeting import MeetingConsumer
from ..consumers.record import RecordConsumer
from ..consumers.snapshot import SnapshotConsumer
from ..models import LayoutPresetId, PublisherId, SourceRole
from ..pipelines.live import LiveRequest
from ..pipelines.meeting import MeetingRequest
from ..pipelines.projector import ProjectorMode, QuestionOverlay
from ..pipelines.record import RecordRequest
from ..pipelines.snapshot import InvalidSnapshotInterval, SnapshotRequest
from ..pipelines.thumbnails import ThumbnailOffer
from ..publishers.base import PublisherBinding
from .auth import require_bearer
from .events import format_sse
from .problems import DomainProblem, InvalidPresetString, NegotiationNotFound

router = APIRouter(dependencies=[Depends(require_bearer)])
public_router = APIRouter()


def _parse_preset(value: str) -> LayoutPresetId:
    try:
        return LayoutPresetId(value)
    except ValueError:
        raise InvalidPresetString(value) from None


def _check_preflight(state) -> None:
    """Before a live/meeting consumer flips on: gst-inspect every required
    element (CH-01/CH-03) — a missing element fails before the lecturer is
    live, not mid-stream. `preflight_check` is None until wired to a real
    `PreflightRunner` (board-only; no GStreamer on this dev host).
    """
    if state.preflight_check is None:
        return
    report = state.preflight_check()
    if not report.ok:
        element = report.problems[0].meta["element"]
        raise DomainProblem("platform_element_missing", "Required platform element missing", 422, {"element": element})


# ── models ───────────────────────────────────────────────────────────────


class CommandAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consumerId: str
    state: str


class PublisherCommandAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    publisherId: str
    state: str


class PublisherCredentialsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=256)


class PublisherBindingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = Field(min_length=1, max_length=2048)
    credentials: PublisherCredentialsBody | None = None
    devicePath: str | None = Field(default=None, max_length=1024)


class ThumbnailStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sources: list[str] | None = None


class RecordStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: str
    ratioA: int | None = None
    ratioB: int | None = None
    outputPath: str | None = None
    outputPaths: dict[str, str] | None = None


class LiveStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: str
    streamKey: str
    ratioA: int | None = None
    ratioB: int | None = None


class MeetingStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: str
    ratioA: int | None = None
    ratioB: int | None = None


class ProjectorModeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["passthrough", "question"]
    questionPayload: QuestionOverlay | None = None


class SnapshotStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intervalSec: int
    outputPath: str


class StopBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["eos", "kill"] = "eos"
    timeoutMs: int | None = None


class LedBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["blink", "off"]


class AudioControlBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gain: int = Field(ge=0, le=100)
    muted: bool


class ThumbnailOfferBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    negotiationId: str
    roleId: str
    sdp: str


class ThumbnailIceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidate: str
    sdpMid: str | None = None
    sdpMLineIndex: int | None = None


# ── publishers ───────────────────────────────────────────────────────────


@router.post("/publishers/{publisher_id}/start", status_code=202)
async def start_publisher(publisher_id: str, request: Request) -> PublisherCommandAccepted:
    try:
        pid = PublisherId(publisher_id)
    except ValueError:
        raise DomainProblem("consumer_not_found", "Unknown publisher", 404, {"publisherId": publisher_id}) from None
    _ = request.app.state.publishers[pid]  # validated the id resolves to a real controller
    return PublisherCommandAccepted(publisherId=publisher_id, state="starting")


@router.post("/publishers/{publisher_id}/stop", status_code=202)
async def stop_publisher(publisher_id: str, request: Request) -> PublisherCommandAccepted:
    try:
        PublisherId(publisher_id)
    except ValueError:
        raise DomainProblem("consumer_not_found", "Unknown publisher", 404, {"publisherId": publisher_id}) from None
    return PublisherCommandAccepted(publisherId=publisher_id, state="stopping")


@router.put("/publishers/{publisher_id}/binding", status_code=202)
async def bind_publisher(publisher_id: str, body: PublisherBindingBody, request: Request) -> PublisherCommandAccepted:
    """Core-api pushes each source binding here (`cmd.admin.set_binding`,
    HL-09) — the one place a camera address/credential reaches the manager.
    A binding change resets the publisher's restart budget; credentials are
    stored for spawn-time property tokens only and are never echoed back."""
    try:
        pid = PublisherId(publisher_id)
    except ValueError:
        raise DomainProblem("consumer_not_found", "Unknown publisher", 404, {"publisherId": publisher_id}) from None
    controller = request.app.state.publishers[pid]
    binding = PublisherBinding(
        address=body.address,
        username=body.credentials.username if body.credentials else None,
        password=body.credentials.password if body.credentials else None,
        device_path=body.devicePath,
    )
    controller.bind(binding)
    # Never echo credentials — the response carries only id + current state.
    return PublisherCommandAccepted(publisherId=publisher_id, state=controller.current_state().value)


# ── record ───────────────────────────────────────────────────────────────


@router.post("/consumers/record", status_code=202)
async def start_record(body: RecordStartBody, request: Request) -> CommandAccepted:
    preset = _parse_preset(body.preset)
    state = request.app.state
    consumer_id = f"record:{state.new_id()}"
    consumer = RecordConsumer(
        consumer_id,
        supervisor=state.supervisor,
        ledger=state.ledger,
        confirmer=state.confirmer,
        platform=state.platform,
        is_publisher_running=state.is_publisher_running,
        is_capture_card_recovering=state.is_capture_card_recovering,
    )
    state.consumers[consumer_id] = consumer
    req = RecordRequest(
        preset=preset, ratio_a=body.ratioA, ratio_b=body.ratioB,
        output_path=body.outputPath, output_paths=body.outputPaths,
    )
    await consumer.start(req)
    await state.events.publish("evt.pm.consumer.running", {"consumerId": consumer_id, "pgid": consumer.pgid})
    return CommandAccepted(consumerId=consumer_id, state="starting")


# ── live ─────────────────────────────────────────────────────────────────


@router.post("/consumers/live", status_code=202)
async def start_live(body: LiveStartBody, request: Request) -> CommandAccepted:
    preset = _parse_preset(body.preset)
    state = request.app.state
    _check_preflight(state)
    consumer_id = f"live:{state.new_id()}"
    consumer = LiveConsumer(
        consumer_id,
        platform=state.platform,
        is_publisher_running=state.is_publisher_running,
        supervisor=state.supervisor,
        ledger=state.ledger,
        confirmer=state.confirmer,
    )
    state.consumers[consumer_id] = consumer
    await consumer.start(LiveRequest(preset=preset, stream_key=body.streamKey, ratio_a=body.ratioA, ratio_b=body.ratioB))
    await state.events.publish("evt.pm.consumer.running", {"consumerId": consumer_id, "pgid": consumer.pgid})
    return CommandAccepted(consumerId=consumer_id, state="starting")


# ── meeting ──────────────────────────────────────────────────────────────


@router.post("/consumers/meeting", status_code=202)
async def start_meeting(body: MeetingStartBody, request: Request) -> CommandAccepted:
    preset = _parse_preset(body.preset)
    state = request.app.state
    _check_preflight(state)
    consumer_id = f"meeting:{state.new_id()}"
    consumer = MeetingConsumer(
        consumer_id,
        platform=state.platform,
        is_publisher_running=state.is_publisher_running,
        supervisor=state.supervisor,
        ledger=state.ledger,
        confirmer=state.confirmer,
    )
    state.consumers[consumer_id] = consumer
    await consumer.start(MeetingRequest(preset=preset, hdmi2_alsa_device=state.settings.hdmi2_alsa_device, ratio_a=body.ratioA, ratio_b=body.ratioB))
    await state.events.publish("evt.pm.consumer.running", {"consumerId": consumer_id, "pgid": consumer.pgid})
    return CommandAccepted(consumerId=consumer_id, state="starting")


# ── projector ────────────────────────────────────────────────────────────


@router.post("/consumers/projector", status_code=202)
async def set_projector_mode(body: ProjectorModeBody, request: Request) -> CommandAccepted:
    state = request.app.state
    consumer = state.projector
    if consumer.process is None:
        await consumer.start()
        await state.events.publish("evt.pm.consumer.running", {"consumerId": consumer.consumer_id, "pgid": consumer.pgid})
    mode = ProjectorMode(body.mode)
    consumer.set_mode(mode, body.questionPayload)
    return CommandAccepted(consumerId=consumer.consumer_id, state="running")


# ── snapshot ─────────────────────────────────────────────────────────────


@router.post("/consumers/snapshot/start", status_code=202)
async def start_snapshot(body: SnapshotStartBody, request: Request) -> CommandAccepted:
    state = request.app.state
    consumer_id = f"snapshot:{state.new_id()}"
    consumer = SnapshotConsumer(
        consumer_id, platform=state.platform, has_ai_subscription=state.has_ai_subscription,
        supervisor=state.supervisor, ledger=state.ledger, confirmer=state.confirmer,
    )
    state.consumers[consumer_id] = consumer
    try:
        await consumer.start(SnapshotRequest(interval_sec=body.intervalSec, output_path=body.outputPath))
    except InvalidSnapshotInterval:
        raise DomainProblem("invalid_ratio", "intervalSec must be >= 1", 400) from None
    await state.events.publish("evt.pm.consumer.running", {"consumerId": consumer_id, "pgid": consumer.pgid})
    return CommandAccepted(consumerId=consumer_id, state="starting")


@router.post("/consumers/snapshot/stop", status_code=202)
async def stop_snapshot(request: Request) -> Response:
    """Stop the running snapshot consumer(s) without the caller needing to
    track the opaque id — core-api addresses snapshot as a singleton AUX
    class (design §3.2)."""
    state = request.app.state
    for consumer_id in [cid for cid in state.consumers if cid.startswith("snapshot:")]:
        consumer = state.consumers[consumer_id]
        try:
            await consumer.stop()
        except ConsumerNotRunning:
            pass
        state.consumers.pop(consumer_id, None)
    return Response(status_code=202)


# ── thumbnails ───────────────────────────────────────────────────────────


@router.post("/consumers/thumbnails/start", status_code=202)
async def start_thumbnails(body: ThumbnailStartBody, request: Request) -> Response:
    """Enable the preview capability, optionally restricting which source
    roles may be negotiated. Absent `sources` means no restriction (the
    prior default); actual media flows only once an `offer` arrives."""
    roles: frozenset[SourceRole] | None = None
    if body.sources is not None:
        try:
            roles = frozenset(SourceRole(value) for value in body.sources)
        except ValueError as exc:
            raise DomainProblem("invalid_preset", "Unknown roleId in sources", 400) from exc
    request.app.state.thumbnails.set_allowed_roles(roles)
    return Response(status_code=202)


@router.post("/consumers/thumbnails/stop", status_code=202)
async def stop_thumbnails(request: Request) -> Response:
    """Close every open negotiation and release their provisional encode
    slots; idempotent when none are open."""
    controller = request.app.state.thumbnails
    for negotiation_id in list(controller.negotiations):
        await controller.close(negotiation_id)
    controller.set_allowed_roles(None)
    return Response(status_code=202)


@router.post("/consumers/thumbnails/offer", status_code=202)
async def thumbnail_offer(body: ThumbnailOfferBody, request: Request) -> CommandAccepted:
    try:
        role = SourceRole(body.roleId)
    except ValueError:
        raise DomainProblem("invalid_preset", "Unknown roleId", 400, {"roleId": body.roleId}) from None

    offer = ThumbnailOffer(type="offer", negotiation_id=body.negotiationId, role_id=role, sdp=body.sdp)
    state = request.app.state
    event = await state.thumbnails.offer(offer)
    return CommandAccepted(consumerId=event.consumer_id, state="starting")


@router.post("/consumers/thumbnails/{negotiation_id}/ice", status_code=202)
async def thumbnail_ice(negotiation_id: str, body: ThumbnailIceBody, request: Request) -> Response:
    state = request.app.state
    if negotiation_id not in state.thumbnails.negotiations:
        raise NegotiationNotFound(negotiation_id)
    return Response(status_code=202)


@router.delete("/consumers/thumbnails/{negotiation_id}", status_code=202)
async def thumbnail_close(negotiation_id: str, request: Request) -> Response:
    await request.app.state.thumbnails.close(negotiation_id)
    return Response(status_code=202)  # idempotent — closing twice is fine


# ── generic consumer stop ───────────────────────────────────────────────


@router.post("/consumers/{consumer_id}/stop", status_code=202)
async def stop_consumer(consumer_id: str, request: Request) -> CommandAccepted:
    state = request.app.state
    consumer = state.consumers.get(consumer_id)
    if consumer is None:
        raise DomainProblem("consumer_not_found", "Unknown consumer", 404, {"consumerId": consumer_id})
    try:
        await consumer.stop()
    except ConsumerNotRunning:
        raise DomainProblem("consumer_not_found", "Consumer is not running", 404, {"consumerId": consumer_id}) from None
    return CommandAccepted(consumerId=consumer_id, state="stopping")


# ── audio ────────────────────────────────────────────────────────────────


@router.put("/audio/controls/mic-lecturer")
async def put_audio_control(body: AudioControlBody, request: Request):
    from ..audio.control import apply_audio_control

    state = request.app.state
    result = await apply_audio_control(
        SourceRole.MIC_LECTURER, body.gain, body.muted,
        card=state.settings.mic_alsa_card, control=state.settings.mic_alsa_control,
        mixer_min=state.settings.mic_mixer_min, mixer_max=state.settings.mic_mixer_max,
        exec_file=state.audio_exec,
    )
    return {
        "roleId": result.role_id.value,
        "appliedGain": result.applied_gain,
        "appliedMuted": result.applied_muted,
        "appliedState": result.applied_state,
        "lastError": result.last_error,
    }


@router.post("/audio/levels/subscriptions", status_code=201)
async def create_audio_level_subscription(request: Request) -> dict:
    state = request.app.state
    sub_id = state.new_id()
    await state.audio_sampler.__aenter__()
    state.audio_subscriptions[sub_id] = True
    return {"subscriptionId": sub_id}


@router.delete("/audio/levels/subscriptions/{subscription_id}", status_code=204)
async def delete_audio_level_subscription(subscription_id: str, request: Request) -> Response:
    state = request.app.state
    if state.audio_subscriptions.pop(subscription_id, None):
        await state.audio_sampler.__aexit__(None, None, None)
    return Response(status_code=204)


# ── device / query ──────────────────────────────────────────────────────


@router.post("/device/led")
async def post_device_led(body: LedBody, request: Request) -> dict:
    from ..hardware.helper_client import HelperError

    state = request.app.state
    try:
        await state.led.apply_recording_state("recording" if body.mode == "blink" else "idle")
    except HelperError:
        # The helper (or GPIO) being unreachable is a logged no-op, not a
        # caller-facing failure — LED is a best-effort derived indicator.
        pass
    return {"mode": body.mode}


@router.get("/sources")
async def get_sources(request: Request) -> dict:
    state = request.app.state
    return {
        pid.value: {
            "roleId": controller.role.value,
            "state": controller.current_state().value,
            "bound": controller.has_binding,
        }
        for pid, controller in state.publishers.items()
    }


@router.get("/status")
async def get_status(request: Request) -> dict:
    state = request.app.state
    return {
        "platform": state.platform.id,
        "encodeLedger": {
            "capacity": state.ledger.capacity,
            "inUse": state.ledger.in_use,
            "reservedBy": list(state.ledger.reserved_by()),
        },
        "publishers": {
            pid.value: {
                "state": controller.current_state().value,
                "bound": controller.has_binding,
                "fps": controller.health.fps,
                "rms": controller.health.rms,
                "lastError": controller.health.last_error,
            }
            for pid, controller in state.publishers.items()
        },
        "consumers": [
            {
                "id": consumer_id,
                "state": consumer.state.value,
                "pgid": consumer.pgid,
            }
            for consumer_id, consumer in state.consumers.items()
        ],
        "device": {"captureCardState": state.watchdog.state, "led": "off"},
        "sequence": state.events.sequence,
    }


@public_router.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "service": "pipeline-manager"}


@router.get("/events")
async def get_events(request: Request):
    state = request.app.state
    last_event_id = request.headers.get("last-event-id")

    async def stream():
        if last_event_id is not None:
            replay = state.events.replay_since(int(last_event_id))
            if replay is None:
                from .events import Event

                yield format_sse(Event(sequence=state.events.sequence, kind="evt.pm.resync-required", data={}))
                return
            for event in replay:
                yield format_sse(event)

        sid, queue = state.events.subscribe()
        try:
            while True:
                if state.events.is_closed(sid) or await request.is_disconnected():
                    return
                try:
                    import asyncio

                    event = await asyncio.wait_for(queue.get(), timeout=0.2)
                except TimeoutError:
                    continue
                yield format_sse(event)
        finally:
            state.events.unsubscribe(sid)

    return StreamingResponse(stream(), media_type="text/event-stream")
