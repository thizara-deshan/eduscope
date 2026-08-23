"""Strict request/response/problem models for question-service.

Field names and shapes mirror core-api's `QuestionGenerateRequest` /
`QuestionGenerateResponse` (`services/core-api/src/modules/ai/clients.ts`) —
core-api is the only caller (ai-services.md §3.4).
"""

from __future__ import annotations

from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AiProblem(BaseModel):
    """The `{code,title,status}` Problem shape shared by every AI service."""

    model_config = ConfigDict(extra="forbid")

    code: str
    title: str
    status: int


class QuestionCount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: int = Field(ge=1)
    max: int = Field(ge=1)

    @model_validator(mode="after")
    def _max_at_least_min(self) -> "QuestionCount":
        if self.max < self.min:
            raise ValueError("count.max must be >= count.min")
        return self


class TranscriptWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fromOffsetMs: int = Field(ge=0)
    toOffsetMs: int = Field(ge=0)
    text: str


class SlideRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    offsetMs: int = Field(ge=0)
    ocrText: str


def _validate_llm_endpoint(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https"):
        raise ValueError("llmEndpoint must be an http(s) URL")
    if not parts.hostname:
        raise ValueError("llmEndpoint must include a host")
    if parts.username or parts.password:
        raise ValueError("llmEndpoint must not carry credentials")
    if parts.fragment:
        raise ValueError("llmEndpoint must not carry a fragment")
    return value


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sessionId: str = Field(min_length=1)
    questionSetId: str = Field(min_length=1)
    count: QuestionCount
    transcript: TranscriptWindow
    slides: list[SlideRecord]
    promptVersion: str | None = None
    llmEndpoint: str

    @field_validator("llmEndpoint")
    @classmethod
    def _check_llm_endpoint(cls, value: str) -> str:
        return _validate_llm_endpoint(value)


class GeneratedOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=512)
    isCorrect: bool


class GeneratedQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=512)
    options: list[GeneratedOption] = Field(min_length=2, max_length=4)

    @field_validator("options")
    @classmethod
    def _exactly_one_correct(cls, value: list[GeneratedOption]) -> list[GeneratedOption]:
        correct_count = sum(1 for option in value if option.isCorrect)
        if correct_count != 1:
            raise ValueError("exactly one option must have isCorrect=true")
        return value


class GenerateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questionSetId: str
    promptVersion: str
    modelId: str | None
    requested: int
    returned: int
    droppedInvalid: int
    questions: list[GeneratedQuestion]
