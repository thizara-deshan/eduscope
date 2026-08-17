from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Sequence

from ..models import Problem
from .platforms.base import PlatformProfile
from .platforms.rk3588 import RK3588Profile


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


RunFn = Callable[[Sequence[str]], Awaitable[ProcessResult]]


@dataclass(frozen=True)
class PreflightReport:
    ok: bool
    present: tuple[str, ...]
    problems: tuple[Problem, ...]


async def _default_run(argv: Sequence[str]) -> ProcessResult:
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return ProcessResult(
        returncode=proc.returncode or 0,
        stdout=stdout.decode(errors="replace"),
        stderr=stderr.decode(errors="replace"),
    )


@dataclass
class PreflightRunner:
    run: RunFn = field(default=_default_run)

    async def inspect(self, elements: Sequence[str]) -> PreflightReport:
        present: list[str] = []
        problems: list[Problem] = []
        for element in elements:
            result = await self.run(["gst-inspect-1.0", element])
            if result.returncode == 0:
                present.append(element)
            else:
                problems.append(
                    Problem(
                        code="platform_element_missing",
                        title="Required platform element missing",
                        status=422,
                        meta={"element": element},
                    )
                )
        return PreflightReport(ok=not problems, present=tuple(present), problems=tuple(problems))

    async def run_for_profile(self, profile: PlatformProfile, *, include_webrtc: bool) -> PreflightReport:
        elements = list(profile.required_elements())
        if not include_webrtc:
            elements = [element for element in elements if element != "webrtcbin"]
        return await self.inspect(elements)


def _profile_for(platform_id: str) -> PlatformProfile:
    if platform_id == "rk3588":
        return RK3588Profile()
    raise ValueError(f"unknown platform: {platform_id}")


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m pipeline_manager.pipelines.preflight")
    parser.add_argument("--platform", required=True, choices=["rk3588"])
    parser.add_argument("--include-webrtc", action="store_true")
    parser.add_argument(
        "--element",
        action="append",
        default=None,
        help="check exactly these elements instead of the platform's required set",
    )
    return parser


async def _main(argv: Sequence[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    runner = PreflightRunner()
    if args.element:
        report = await runner.inspect(args.element)
    else:
        profile = _profile_for(args.platform)
        report = await runner.run_for_profile(profile, include_webrtc=args.include_webrtc)

    for element in report.present:
        print(f"present {element}")
    for problem in report.problems:
        print(f"platform_element_missing {problem.meta['element']}")
    return 0 if report.ok else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
