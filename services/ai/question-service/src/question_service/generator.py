"""The 40-second question generation coordinator (ai-services.md §3.1/§3.4).

Loads the immutable prompt assets once, renders the untrusted transcript/
slide material only through Jinja's `tojson` (never as template code — see
prompts/mcq/v1/user.md.j2 and C-06's render-escaping tests), enters one
enclosing deadline around the C-07 llama client call, and maps the outcome
onto `GenerateResponse` or a typed `GenerationError`. This module owns no
queue or retry beyond C-07's single internal repair pass.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import jsonschema
from jinja2 import Environment, FileSystemLoader, StrictUndefined, Template

from .llama import LlamaClient, LlamaError
from .models import AiProblem, GenerateRequest, GenerateResponse

GENERATION_DEADLINE_SECONDS = 40.0
DEFAULT_PROMPT_VERSION = "mcq/v1"


class GenerationError(Exception):
    """Base for every typed `/generate` failure this module raises."""

    def __init__(self, problem: AiProblem) -> None:
        super().__init__(problem.code)
        self.problem = problem


class UnknownPromptVersionError(GenerationError):
    def __init__(self, prompt_version: str) -> None:
        super().__init__(AiProblem(code="bad-request", title="Invalid generation request", status=400))
        self.prompt_version = prompt_version


class NoValidQuestionsError(GenerationError):
    def __init__(self) -> None:
        super().__init__(
            AiProblem(code="llm.invalid-payload", title="LLM returned no valid questions", status=422)
        )


class GenerationTimeoutError(GenerationError):
    def __init__(self) -> None:
        super().__init__(AiProblem(code="llm.timeout", title="LLM generation timed out", status=504))


@dataclass(frozen=True)
class PromptAssets:
    version_dir: Path
    system_prompt: str
    user_template: Template
    grammar: str
    digest: str


def locate_prompt_root(start: Path | None = None) -> Path:
    """Find the `prompts/` directory next to this package.

    Editable installs keep `prompts/` as a sibling of `src/` (the source-tree
    layout C-06 shipped); a built wheel places it inside the installed
    package via `force-include`. Both are checked so tests and a real
    install resolve the same assets.
    """
    here = (start or Path(__file__)).resolve()
    candidates = [here.parent / "prompts", here.parents[2] / "prompts"]
    for candidate in candidates:
        if (candidate / "mcq" / "v1" / "schema.json").exists():
            return candidate
    raise FileNotFoundError("mcq/v1 prompt assets not found next to question_service")


def _resolve_version_dir(prompt_root: Path, prompt_version: str) -> Path:
    parts = prompt_version.split("/")
    if len(parts) != 2 or not all(parts):
        raise UnknownPromptVersionError(prompt_version)
    candidate = prompt_root.joinpath(*parts)
    required = ("system.md", "user.md.j2", "grammar.gbnf", "schema.json")
    if not candidate.is_dir() or not all((candidate / name).is_file() for name in required):
        raise UnknownPromptVersionError(prompt_version)
    return candidate


def load_prompt_assets(prompt_root: Path, prompt_version: str) -> PromptAssets:
    version_dir = _resolve_version_dir(prompt_root, prompt_version)

    schema = json.loads((version_dir / "schema.json").read_text())
    jsonschema.Draft202012Validator.check_schema(schema)

    system_prompt = (version_dir / "system.md").read_text()
    grammar = (version_dir / "grammar.gbnf").read_text()
    env = Environment(loader=FileSystemLoader(str(version_dir)), undefined=StrictUndefined, autoescape=False)
    user_template = env.get_template("user.md.j2")

    digest = hashlib.sha256()
    for name in ("system.md", "user.md.j2", "grammar.gbnf", "schema.json"):
        digest.update((version_dir / name).read_bytes())

    return PromptAssets(
        version_dir=version_dir,
        system_prompt=system_prompt,
        user_template=user_template,
        grammar=grammar,
        digest=digest.hexdigest(),
    )


def _render_prompt(assets: PromptAssets, request: GenerateRequest) -> str:
    user_prompt = assets.user_template.render(
        count={"min": request.count.min, "max": request.count.max},
        transcript={
            "text": request.transcript.text,
            "fromOffsetMs": request.transcript.fromOffsetMs,
            "toOffsetMs": request.transcript.toOffsetMs,
        },
        slides=[{"offsetMs": slide.offsetMs, "ocrText": slide.ocrText} for slide in request.slides],
    )
    return f"{assets.system_prompt}\n\n{user_prompt}"


class QuestionGenerator:
    def __init__(
        self,
        prompt_root: Path,
        llama_client: LlamaClient,
        *,
        deadline_seconds: float = GENERATION_DEADLINE_SECONDS,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._prompt_root = prompt_root
        self._llama_client = llama_client
        self._deadline_seconds = deadline_seconds
        self._clock = clock or time.monotonic
        self._assets_cache: dict[str, PromptAssets] = {}
        self.last_generation_at: datetime | None = None
        self.last_error: AiProblem | None = None

        # Load and validate the default version eagerly so a broken/missing
        # shipped asset fails at startup, not on the first request.
        self._assets(DEFAULT_PROMPT_VERSION)

    @property
    def prompt_versions(self) -> list[str]:
        return [DEFAULT_PROMPT_VERSION]

    def _assets(self, prompt_version: str) -> PromptAssets:
        cached = self._assets_cache.get(prompt_version)
        if cached is None:
            cached = load_prompt_assets(self._prompt_root, prompt_version)
            self._assets_cache[prompt_version] = cached
        return cached

    async def generate(self, request: GenerateRequest) -> GenerateResponse:
        try:
            response = await self._generate(request)
        except (GenerationError, LlamaError) as exc:
            self.last_error = exc.problem
            self.last_generation_at = datetime.now(timezone.utc)
            raise
        else:
            self.last_error = None
            self.last_generation_at = datetime.now(timezone.utc)
            return response

    async def _generate(self, request: GenerateRequest) -> GenerateResponse:
        prompt_version = request.promptVersion or DEFAULT_PROMPT_VERSION
        assets = self._assets(prompt_version)
        full_prompt = _render_prompt(assets, request)

        deadline_start = self._clock()

        def remaining_budget_ms() -> int:
            elapsed = self._clock() - deadline_start
            return max(0, int((self._deadline_seconds - elapsed) * 1000))

        try:
            async with asyncio.timeout(self._deadline_seconds):
                outcome = await self._llama_client.generate(
                    request.llmEndpoint,
                    full_prompt,
                    assets.grammar,
                    remaining_budget_ms=remaining_budget_ms,
                )
        except TimeoutError:
            raise GenerationTimeoutError() from None

        if not outcome.survivors:
            raise NoValidQuestionsError()

        return GenerateResponse(
            questionSetId=request.questionSetId,
            promptVersion=prompt_version,
            modelId=outcome.model_id,
            requested=request.count.max,
            returned=len(outcome.survivors),
            droppedInvalid=outcome.dropped_invalid,
            questions=outcome.survivors,
        )
