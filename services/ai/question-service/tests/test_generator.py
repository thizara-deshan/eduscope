from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import pytest
from question_service.generator import (
    DEFAULT_PROMPT_VERSION,
    GenerationTimeoutError,
    NoValidQuestionsError,
    QuestionGenerator,
    UnknownPromptVersionError,
    locate_prompt_root,
)
from question_service.llama import GenerationOutcome, LlamaUnreachableError
from question_service.models import GenerateRequest, GeneratedOption, GeneratedQuestion

FIXTURE = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "generate-request.json").read_text()
)
PROMPT_ROOT = locate_prompt_root()


class FakeLlamaClient:
    def __init__(self, outcome=None, *, exception=None, delay: float = 0.0, on_call=None) -> None:
        self._outcome = outcome
        self._exception = exception
        self._delay = delay
        self._on_call = on_call
        self.calls: list[dict] = []

    async def generate(self, llm_endpoint, prompt, grammar, *, remaining_budget_ms=None):
        self.calls.append(
            {
                "llm_endpoint": llm_endpoint,
                "prompt": prompt,
                "grammar": grammar,
                "remaining_budget_ms": remaining_budget_ms() if remaining_budget_ms else None,
            }
        )
        if self._on_call is not None:
            self._on_call()
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._exception is not None:
            raise self._exception
        return self._outcome


def _survivor(prompt: str = "What remains constant?") -> GeneratedQuestion:
    return GeneratedQuestion(
        prompt=prompt,
        options=[GeneratedOption(text="Energy", isCorrect=True), GeneratedOption(text="Temperature", isCorrect=False)],
    )


def _outcome(survivor_count: int = 4, dropped: int = 1, model_id: str | None = "llama-3.1-8b-instruct-q4_k_m") -> GenerationOutcome:
    return GenerationOutcome(
        survivors=[_survivor(f"q{i}") for i in range(survivor_count)],
        dropped_invalid=dropped,
        model_id=model_id,
        completion_count=1,
    )


class TestQuestionGeneratorHappyPath:
    @pytest.mark.asyncio
    async def test_generates_from_a_validated_3_to_5_request(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate(FIXTURE)

        response = await generator.generate(request)

        assert response.questionSetId == FIXTURE["questionSetId"]
        assert response.promptVersion == "mcq/v1"
        assert response.modelId == "llama-3.1-8b-instruct-q4_k_m"
        assert response.requested == FIXTURE["count"]["max"]
        assert response.returned == 4
        assert response.droppedInvalid == 1
        assert len(response.questions) == 4

    @pytest.mark.asyncio
    async def test_defaults_to_mcq_v1_when_prompt_version_is_omitted(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        body = {**FIXTURE}
        del body["promptVersion"]
        request = GenerateRequest.model_validate(body)

        response = await generator.generate(request)

        assert response.promptVersion == DEFAULT_PROMPT_VERSION

    @pytest.mark.asyncio
    async def test_honors_a_pinned_prompt_version(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate({**FIXTURE, "promptVersion": "mcq/v1"})

        response = await generator.generate(request)

        assert response.promptVersion == "mcq/v1"

    @pytest.mark.asyncio
    async def test_sends_the_rendered_prompt_and_grammar_to_the_llama_client(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate(FIXTURE)

        await generator.generate(request)

        assert len(client.calls) == 1
        call = client.calls[0]
        assert call["llm_endpoint"] == FIXTURE["llmEndpoint"]
        assert "Energy cannot be created or destroyed." in call["prompt"]
        assert "root ::=" in call["grammar"]

    @pytest.mark.asyncio
    async def test_tracks_last_generation_at_and_clears_last_error_on_success(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate(FIXTURE)

        assert generator.last_generation_at is None
        await generator.generate(request)

        assert generator.last_generation_at is not None
        assert generator.last_error is None


class TestQuestionGeneratorFailureMapping:
    @pytest.mark.asyncio
    async def test_unknown_prompt_version_is_a_bad_request(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate({**FIXTURE, "promptVersion": "mcq/v99"})

        with pytest.raises(UnknownPromptVersionError) as excinfo:
            await generator.generate(request)

        assert excinfo.value.problem.code == "bad-request"
        assert excinfo.value.problem.status == 400
        assert client.calls == []

    @pytest.mark.asyncio
    async def test_zero_survivors_after_repair_is_invalid_payload(self) -> None:
        client = FakeLlamaClient(
            outcome=GenerationOutcome(survivors=[], dropped_invalid=3, model_id=None, completion_count=2)
        )
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate(FIXTURE)

        with pytest.raises(NoValidQuestionsError) as excinfo:
            await generator.generate(request)

        assert excinfo.value.problem.code == "llm.invalid-payload"
        assert excinfo.value.problem.status == 422

    @pytest.mark.asyncio
    async def test_connect_failure_propagates_as_unreachable_within_five_seconds(self) -> None:
        client = FakeLlamaClient(exception=LlamaUnreachableError())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate(FIXTURE)

        start = time.monotonic()
        with pytest.raises(LlamaUnreachableError) as excinfo:
            await generator.generate(request)
        elapsed = time.monotonic() - start

        assert excinfo.value.problem.code == "llm.unreachable"
        assert excinfo.value.problem.status == 503
        assert elapsed < 5.0

    @pytest.mark.asyncio
    async def test_hitting_the_deadline_is_a_typed_timeout_not_a_hang(self) -> None:
        client = FakeLlamaClient(outcome=_outcome(), delay=1.0)
        generator = QuestionGenerator(PROMPT_ROOT, client, deadline_seconds=0.05)
        request = GenerateRequest.model_validate(FIXTURE)

        with pytest.raises(GenerationTimeoutError) as excinfo:
            await generator.generate(request)

        assert excinfo.value.problem.code == "llm.timeout"
        assert excinfo.value.problem.status == 504

    @pytest.mark.asyncio
    async def test_the_deadline_nests_around_the_original_and_repair_attempt_together(self) -> None:
        # The fake client models "one repair pass" internally by sleeping
        # past the deadline itself — the generator's job is only to enforce
        # ONE enclosing deadline around whatever C-07 does, original attempt
        # and repair together, not a separate budget per attempt.
        client = FakeLlamaClient(outcome=_outcome(), delay=0.2)
        generator = QuestionGenerator(PROMPT_ROOT, client, deadline_seconds=0.05)
        request = GenerateRequest.model_validate(FIXTURE)

        with pytest.raises(GenerationTimeoutError):
            await generator.generate(request)

    @pytest.mark.asyncio
    async def test_failure_updates_status_tracking(self) -> None:
        client = FakeLlamaClient(exception=LlamaUnreachableError())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        request = GenerateRequest.model_validate(FIXTURE)

        with pytest.raises(LlamaUnreachableError):
            await generator.generate(request)

        assert generator.last_generation_at is not None
        assert generator.last_error is not None
        assert generator.last_error.code == "llm.unreachable"


class TestPromptAssetLoading:
    def test_construction_eagerly_loads_and_validates_the_default_version(self) -> None:
        client = FakeLlamaClient(outcome=_outcome())
        generator = QuestionGenerator(PROMPT_ROOT, client)
        assert generator.prompt_versions == [DEFAULT_PROMPT_VERSION]

    def test_locate_prompt_root_finds_the_shipped_mcq_v1_assets(self) -> None:
        assert (PROMPT_ROOT / "mcq" / "v1" / "schema.json").is_file()
