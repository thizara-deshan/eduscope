"""llama.cpp `/completion` client, model-id resolution, and the one repair pass.

C-08 owns the enclosing 40-second generation deadline and the LLM-endpoint
budget accounting; this module only performs the per-request HTTP work and
never retries beyond the single internal repair attempt (ai-services.md
§3.3/§3.4). Transport failures are mapped to typed exceptions carrying an
`AiProblem` and never include the endpoint URL, prompt, or transcript text.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .models import AiProblem
from .parser import GeneratedQuestion, SalvageResult, salvage_questions

COMPLETION_TIMEOUT = httpx.Timeout(connect=5.0, read=None, write=5.0, pool=5.0)

_N_PREDICT = 1200
_TEMPERATURE = 0.3
_PROPS_MIN_BUDGET_MS = 1000
_REPAIR_INSTRUCTION = (
    "\n\nYour previous output failed validation because: {errors}\n"
    "Return only corrected JSON."
)


class LlamaError(Exception):
    """Base for every typed llama.cpp client failure."""

    def __init__(self, problem: AiProblem) -> None:
        super().__init__(problem.code)
        self.problem = problem


class LlamaUnreachableError(LlamaError):
    def __init__(self) -> None:
        super().__init__(AiProblem(code="llm.unreachable", title="LLM is unreachable", status=503))


@dataclass(frozen=True)
class LlamaCompletion:
    content: str | None
    model: str | None


@dataclass(frozen=True)
class GenerationOutcome:
    survivors: list[GeneratedQuestion]
    dropped_invalid: int
    model_id: str | None
    completion_count: int


def _completion_body(prompt: str, grammar: str) -> dict[str, object]:
    return {
        "prompt": prompt,
        "n_predict": _N_PREDICT,
        "temperature": _TEMPERATURE,
        "grammar": grammar,
        "cache_prompt": True,
    }


def _repair_prompt(prompt: str, result: SalvageResult) -> str:
    errors = "; ".join(result.errors) if result.errors else "no valid items were returned"
    return prompt + _REPAIR_INSTRUCTION.format(errors=errors)


class LlamaClient:
    def __init__(self, http_client: httpx.AsyncClient) -> None:
        self._http_client = http_client

    async def complete(self, llm_endpoint: str, prompt: str, grammar: str) -> LlamaCompletion:
        """One raw `/completion` call. Never retries; never repairs."""
        url = f"{llm_endpoint.rstrip('/')}/completion"
        try:
            response = await self._http_client.post(
                url, json=_completion_body(prompt, grammar), timeout=COMPLETION_TIMEOUT
            )
        except httpx.TransportError:
            raise LlamaUnreachableError() from None

        if response.status_code // 100 != 2:
            return LlamaCompletion(content=None, model=None)

        try:
            payload = response.json()
        except ValueError:
            return LlamaCompletion(content=None, model=None)

        if not isinstance(payload, dict):
            return LlamaCompletion(content=None, model=None)

        content = payload.get("content")
        if not isinstance(content, str):
            content = None

        model = payload.get("model")
        if not isinstance(model, str) or not model:
            model = None

        return LlamaCompletion(content=content, model=model)

    async def resolve_model_id(
        self,
        llm_endpoint: str,
        *,
        completion_model: str | None,
        remaining_budget_ms: int | None,
    ) -> str | None:
        """Prefer the completion's own `model`; fall back to `/props` only
        when the caller-supplied remaining budget can plausibly absorb it."""
        if completion_model:
            return completion_model
        if remaining_budget_ms is None or remaining_budget_ms < _PROPS_MIN_BUDGET_MS:
            return None

        url = f"{llm_endpoint.rstrip('/')}/props"
        try:
            response = await self._http_client.get(url, timeout=COMPLETION_TIMEOUT)
        except httpx.TransportError:
            return None

        if response.status_code // 100 != 2:
            return None

        try:
            payload = response.json()
        except ValueError:
            return None

        if not isinstance(payload, dict):
            return None

        model = payload.get("model")
        if not isinstance(model, str) or not model:
            settings = payload.get("default_generation_settings")
            model = settings.get("model") if isinstance(settings, dict) else None

        return model if isinstance(model, str) and model else None

    async def generate(
        self,
        llm_endpoint: str,
        prompt: str,
        grammar: str,
        *,
        remaining_budget_ms: int | None = None,
    ) -> GenerationOutcome:
        """One completion, one optional repair pass, then model-id resolution."""
        first = await self.complete(llm_endpoint, prompt, grammar)
        result = salvage_questions(first.content)
        completion_count = 1
        latest_model = first.model

        if not result.survivors and first.content:
            second = await self.complete(llm_endpoint, _repair_prompt(prompt, result), grammar)
            result = salvage_questions(second.content)
            completion_count = 2
            latest_model = second.model or latest_model

        model_id = await self.resolve_model_id(
            llm_endpoint,
            completion_model=latest_model,
            remaining_budget_ms=remaining_budget_ms,
        )

        return GenerationOutcome(
            survivors=result.survivors,
            dropped_invalid=result.dropped_invalid,
            model_id=model_id,
            completion_count=completion_count,
        )
