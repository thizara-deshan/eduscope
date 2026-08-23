"""Balanced JSON-array extraction and per-item MCQ salvage (ai-services.md §3.3).

The GBNF grammar (prompts/mcq/v1/grammar.gbnf) is the primary structural
guarantee; this module is defense in depth for non-grammar-capable servers
and for the two validation classes the grammar cannot express: length caps
and near-duplicate option text.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field

from pydantic import ValidationError

from .models import GeneratedQuestion


class ExtractionError(ValueError):
    """Raised when no complete top-level JSON array is present in the text."""


def extract_first_json_array(text: str) -> str:
    """Scan `text` once and return the first complete top-level `[...]` block.

    Tracks bracket depth, string state, and escapes so it does not need a
    greedy regex and safely skips markdown fences/prefixes and nested arrays
    (e.g. each question's `options` list).
    """
    depth = 0
    start_index: int | None = None
    in_string = False
    escape = False

    for index, char in enumerate(text):
        if start_index is None:
            if char == "[":
                start_index = index
                depth = 1
            continue

        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return text[start_index : index + 1]

    raise ExtractionError("no complete top-level JSON array found in llama.cpp output")


def _normalize_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.split())


def _normalize_option(option: object) -> object:
    if not isinstance(option, dict):
        return option
    normalized = dict(option)
    if "text" in normalized:
        normalized["text"] = _normalize_text(normalized["text"])
    return normalized


def _normalize_item(raw_item: object) -> object:
    if not isinstance(raw_item, dict):
        return raw_item
    normalized = dict(raw_item)
    if "prompt" in normalized:
        normalized["prompt"] = _normalize_text(normalized["prompt"])
    options = normalized.get("options")
    if isinstance(options, list):
        normalized["options"] = [_normalize_option(option) for option in options]
    return normalized


def _duplicate_option_key(option_text: str) -> str:
    return option_text.casefold()


def _has_near_duplicate_options(question: GeneratedQuestion) -> bool:
    seen: set[str] = set()
    for option in question.options:
        key = _duplicate_option_key(option.text)
        if key in seen:
            return True
        seen.add(key)
    return False


def _compact_pydantic_error(exc: ValidationError) -> str:
    parts = [f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in exc.errors()]
    return "; ".join(parts) if parts else "invalid item"


@dataclass(frozen=True)
class SalvageResult:
    survivors: list[GeneratedQuestion]
    dropped_invalid: int
    errors: tuple[str, ...] = field(default_factory=tuple)


def salvage_questions(content: str | None) -> SalvageResult:
    """Extract, parse, and per-item validate an MCQ batch from raw LLM output.

    Invalid items are dropped and counted; at least one surviving item makes
    the batch usable. B performs its own second, independent validation pass.
    """
    if not content:
        return SalvageResult(survivors=[], dropped_invalid=0)

    try:
        array_text = extract_first_json_array(content)
        raw_items = json.loads(array_text)
    except (ExtractionError, json.JSONDecodeError):
        return SalvageResult(survivors=[], dropped_invalid=0)

    if not isinstance(raw_items, list):
        return SalvageResult(survivors=[], dropped_invalid=0)

    survivors: list[GeneratedQuestion] = []
    errors: list[str] = []
    dropped = 0

    for raw_item in raw_items:
        try:
            question = GeneratedQuestion.model_validate(_normalize_item(raw_item))
        except ValidationError as exc:
            dropped += 1
            errors.append(_compact_pydantic_error(exc))
            continue
        if _has_near_duplicate_options(question):
            dropped += 1
            errors.append("options: near-duplicate text after casefold/trim")
            continue
        survivors.append(question)

    return SalvageResult(survivors=survivors, dropped_invalid=dropped, errors=tuple(errors))
