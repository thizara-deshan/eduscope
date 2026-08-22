from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Sequence

from ..models import AudioControlResult, SourceRole

NAME_PATTERN = re.compile(r"^[A-Za-z0-9 _.-]{1,64}$")
_PERCENT_RE = re.compile(r"\[(\d{1,3})%\]")
_SWITCH_RE = re.compile(r"\[(on|off)\]")


class UnsupportedAudioRole(ValueError):
    pass


class InvalidGain(ValueError):
    pass


class InvalidDeviceName(ValueError):
    pass


@dataclass(frozen=True)
class ExecResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


ExecFn = Callable[[Sequence[str]], Awaitable[ExecResult]]
LogFn = Callable[[dict], None]


async def real_amixer_exec(argv: Sequence[str]) -> ExecResult:
    """Argv-only async `amixer` adapter (A-REV-012) — the real `audio_exec`
    seam `create_production_app` injects. `asyncio.create_subprocess_exec`
    only: never a shell string, matching every other spawn in this service.
    """
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    returncode = process.returncode if process.returncode is not None else 1
    return ExecResult(
        returncode=returncode,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
    )


def _validate_name(name: str, *, field: str) -> None:
    if not NAME_PATTERN.match(name):
        raise InvalidDeviceName(f"{field} must match {NAME_PATTERN.pattern}")


def _parse_sget(output: str) -> tuple[int | None, bool | None]:
    percent_match = _PERCENT_RE.search(output)
    switch_match = _SWITCH_RE.search(output)
    gain = int(percent_match.group(1)) if percent_match else None
    muted = (switch_match.group(1) == "off") if switch_match else None
    return gain, muted


async def apply_audio_control(
    role: SourceRole,
    gain: int,
    muted: bool,
    *,
    card: str,
    control: str,
    mixer_min: int = 0,
    mixer_max: int = 100,
    exec_file: ExecFn,
    log: LogFn | None = None,
) -> AudioControlResult:
    """Argv-only mixer apply/readback. Only `mic-lecturer` is accepted; gain
    0..100 maps through the configured mixer min/max; applied state comes
    from a follow-up `sget`, never an echo of the request. Device identifiers
    stay out of the returned (public) error; `log`, if given, gets the full
    structured context for journald.
    """
    if role is not SourceRole.MIC_LECTURER:
        raise UnsupportedAudioRole(f"{role.value} has no audio control")
    if not (0 <= gain <= 100):
        raise InvalidGain("gain must be within 0..100")

    _validate_name(card, field="card")
    _validate_name(control, field="control")

    mixer_value = mixer_min + round((gain / 100) * (mixer_max - mixer_min))
    switch = "off" if muted else "on"

    set_result = await exec_file(["amixer", "--card", card, "sset", control, f"{mixer_value}%", switch])
    if log is not None:
        log({"card": card, "control": control, "gain": gain, "muted": muted, "stage": "sset", "stderr": set_result.stderr})
    if set_result.returncode != 0:
        return AudioControlResult(
            role_id=role, applied_state="failed", last_error="mixer apply failed"
        )

    get_result = await exec_file(["amixer", "--card", card, "sget", control])
    if log is not None:
        log({"card": card, "control": control, "stage": "sget", "stdout": get_result.stdout})
    if get_result.returncode != 0:
        return AudioControlResult(
            role_id=role, applied_state="failed", last_error="mixer readback failed"
        )

    applied_gain, applied_muted = _parse_sget(get_result.stdout)
    if applied_gain is None or applied_muted is None:
        return AudioControlResult(
            role_id=role, applied_state="failed", last_error="mixer readback unparsable"
        )

    return AudioControlResult(
        role_id=role, applied_gain=applied_gain, applied_muted=applied_muted, applied_state="applied"
    )
