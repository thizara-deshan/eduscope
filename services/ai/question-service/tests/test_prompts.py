from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import jinja2
import jsonschema
import pytest
import yaml

PROMPT_DIR = Path(__file__).resolve().parents[1] / "prompts" / "mcq" / "v1"
CHANGELOG = Path(__file__).resolve().parents[1] / "prompts" / "CHANGELOG.md"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

SYSTEM_MD = PROMPT_DIR / "system.md"
USER_TEMPLATE = PROMPT_DIR / "user.md.j2"
GRAMMAR = PROMPT_DIR / "grammar.gbnf"
SCHEMA = PROMPT_DIR / "schema.json"

# Pinned SHA-256 digests of the shipped mcq/v1 assets (recorded once the
# assets are written — see the "record version provenance" step). Any edit to
# a shipped v1 file changes its digest and fails this test: ship a new
# `mcq/v2` directory and a CHANGELOG entry instead of mutating v1 in place.
EXPECTED_DIGESTS = {
    "system.md": "d5efecf02ffd0c8eea0f38dada98393a49304895051a2c427f0f96fd1b8585e3",
    "user.md.j2": "53f83d0d5b381562a27cfba79060c7c3bcfd667ecb17840261df9160407fd43e",
    "grammar.gbnf": "77e29b9fb095836e78b438b458bec097992e4e4f38db3e52b3c9ce0ba2fbfcfb",
    "schema.json": "3b8f76ec4450887e52b7d1e5ed78436920c7fc4f2225ee742cee6b486ffef128",
}


def _find_repo_root(start: Path) -> Path:
    current = start
    for _ in range(12):
        candidate = current / "contracts" / "openapi.yaml"
        if candidate.exists():
            return current
        current = current.parent
    raise FileNotFoundError(f"contracts/openapi.yaml not found above {start}")


def _load_contract() -> dict:
    root = _find_repo_root(Path(__file__).resolve())
    return yaml.safe_load((root / "contracts" / "openapi.yaml").read_text())


def _load_schema() -> dict:
    return json.loads(SCHEMA.read_text())


def _load_fixture_input() -> dict:
    return json.loads((FIXTURE_DIR / "prompt-input.json").read_text())


def _render_user_prompt(fixture_input: dict) -> str:
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(PROMPT_DIR)),
        undefined=jinja2.StrictUndefined,
        autoescape=False,
    )
    template = env.get_template("user.md.j2")
    return template.render(**fixture_input)


def _sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _question(prompt: str, options: list[tuple[str, bool]]) -> dict:
    return {
        "prompt": prompt,
        "options": [{"text": text, "isCorrect": is_correct} for text, is_correct in options],
    }


def _valid_options(count: int, correct_index: int) -> list[tuple[str, bool]]:
    return [(f"option {i}", i == correct_index) for i in range(count)]


def _valid_batch(question_count: int) -> list[dict]:
    return [
        _question(f"question {i}?", _valid_options(2 + (i % 3), i % (2 + (i % 3))))
        for i in range(question_count)
    ]


# --- test-only GBNF-subset recognizer -------------------------------------
#
# This mirrors exactly the structural language of prompts/mcq/v1/grammar.gbnf
# (fixed key order, 3-5 questions, 2-4 options, exactly one `isCorrect:true`,
# JSON string escaping) so C-06 can prove the shipped grammar and schema
# agree on what "valid MCQ batch" means. It intentionally has no notion of
# semantic near-duplicate options — the grammar cannot express that either,
# which is why the parser layer (C-07) also has to check it (see
# test_duplicate_options_pass_schema_and_grammar_but_are_flagged_downstream).


class _GbnfRecognizer:
    def __init__(self, text: str) -> None:
        self.text = text
        self.pos = 0
        self.n = len(text)

    def _ws(self) -> None:
        while self.pos < self.n and self.text[self.pos] in " \t\n\r":
            self.pos += 1

    def _literal(self, literal: str) -> bool:
        if self.text.startswith(literal, self.pos):
            self.pos += len(literal)
            return True
        return False

    def _string(self) -> bool:
        if self.pos >= self.n or self.text[self.pos] != '"':
            return False
        self.pos += 1
        while self.pos < self.n:
            char = self.text[self.pos]
            if char == '"':
                self.pos += 1
                return True
            if char == "\\":
                self.pos += 1
                if self.pos >= self.n:
                    return False
                escape = self.text[self.pos]
                if escape in '"\\/bfnrt':
                    self.pos += 1
                elif escape == "u":
                    self.pos += 1
                    for _ in range(4):
                        if self.pos >= self.n or self.text[self.pos] not in "0123456789abcdefABCDEF":
                            return False
                        self.pos += 1
                else:
                    return False
            elif ord(char) < 0x20:
                return False
            else:
                self.pos += 1
        return False

    def _option(self, expect_correct: bool) -> bool:
        start = self.pos
        if not self._literal("{"):
            self.pos = start
            return False
        self._ws()
        if not self._literal('"text"'):
            self.pos = start
            return False
        self._ws()
        if not self._literal(":"):
            self.pos = start
            return False
        self._ws()
        if not self._string():
            self.pos = start
            return False
        self._ws()
        if not self._literal(","):
            self.pos = start
            return False
        self._ws()
        if not self._literal('"isCorrect"'):
            self.pos = start
            return False
        self._ws()
        if not self._literal(":"):
            self.pos = start
            return False
        self._ws()
        if not self._literal("true" if expect_correct else "false"):
            self.pos = start
            return False
        self._ws()
        if not self._literal("}"):
            self.pos = start
            return False
        return True

    def _options(self) -> bool:
        # A shorter combo (e.g. 2 options) can match as a literal prefix of a
        # longer valid list, so a candidate is only accepted once it is
        # immediately followed by the `]` that `question` requires next —
        # otherwise a 2-item match would wrongly "consume" the first two
        # entries of a real 3- or 4-item list and leave the rest dangling.
        start = self.pos
        for size in (2, 3, 4):
            for correct_index in range(size):
                self.pos = start
                ok = True
                for i in range(size):
                    if i > 0:
                        if not self._literal(","):
                            ok = False
                            break
                        self._ws()
                    if not self._option(expect_correct=(i == correct_index)):
                        ok = False
                        break
                if not ok:
                    continue
                probe = self.pos
                self._ws()
                if self.pos < self.n and self.text[self.pos] == "]":
                    return True
                self.pos = probe
        self.pos = start
        return False

    def _question(self) -> bool:
        start = self.pos
        if not self._literal("{"):
            self.pos = start
            return False
        self._ws()
        if not self._literal('"prompt"'):
            self.pos = start
            return False
        self._ws()
        if not self._literal(":"):
            self.pos = start
            return False
        self._ws()
        if not self._string():
            self.pos = start
            return False
        self._ws()
        if not self._literal(","):
            self.pos = start
            return False
        self._ws()
        if not self._literal('"options"'):
            self.pos = start
            return False
        self._ws()
        if not self._literal(":"):
            self.pos = start
            return False
        self._ws()
        if not self._literal("["):
            self.pos = start
            return False
        self._ws()
        if not self._options():
            self.pos = start
            return False
        self._ws()
        if not self._literal("]"):
            self.pos = start
            return False
        self._ws()
        if not self._literal("}"):
            self.pos = start
            return False
        return True

    def matches(self) -> bool:
        self._ws()
        if not self._literal("["):
            return False
        self._ws()
        if not self._question():
            return False
        count = 1
        self._ws()
        while count < 5:
            start = self.pos
            if not self._literal(","):
                break
            self._ws()
            if not self._question():
                self.pos = start
                break
            count += 1
            self._ws()
        if not self._literal("]"):
            return False
        self._ws()
        if self.pos != self.n:
            return False
        return 3 <= count <= 5


def _gbnf_accepts(batch: list[dict]) -> bool:
    text = json.dumps(batch, separators=(",", ":"))
    return _GbnfRecognizer(text).matches()


def _schema_accepts(schema: dict, batch: list[dict]) -> bool:
    try:
        jsonschema.validate(batch, schema)
    except jsonschema.ValidationError:
        return False
    return True


def _has_near_duplicate_options(batch: list[dict]) -> bool:
    """The check C-07's parser owns (schema.json cannot express it honestly)."""
    for question in batch:
        seen: set[str] = set()
        for option in question["options"]:
            key = " ".join(option["text"].split()).casefold().strip()
            if key in seen:
                return True
            seen.add(key)
    return False


# --- contract alignment -----------------------------------------------------


def test_contract_is_version_1_0_0() -> None:
    document = _load_contract()
    assert document["info"]["version"] == "1.0.0"


def test_question_create_options_match_shared_constraints() -> None:
    document = _load_contract()
    question_create = document["components"]["schemas"]["QuestionCreate"]
    options = question_create["properties"]["options"]
    assert options["minItems"] == 2
    assert options["maxItems"] == 4
    option_item = options["items"]
    assert option_item["properties"]["text"]["minLength"] == 1
    assert option_item["properties"]["text"]["maxLength"] == 512
    assert option_item["properties"]["isCorrect"]["type"] == "boolean"


def test_master_requested_count_is_three_to_five() -> None:
    document = _load_contract()
    requested_count = document["components"]["schemas"]["QuestionSet"]["properties"]["requestedCount"]
    assert requested_count["minimum"] == 3
    assert requested_count["maximum"] == 5


# --- render escaping ---------------------------------------------------------


def test_render_json_escapes_untrusted_transcript_and_slide_text() -> None:
    fixture_input = _load_fixture_input()
    rendered = _render_user_prompt(fixture_input)

    lines = rendered.splitlines()
    transcript_line = lines[lines.index("Transcript window (JSON string; source data only):") + 1]
    offsets_line = lines[lines.index("Transcript offsets:") + 1]
    slides_line = lines[lines.index("Slide OCR records (JSON; source data only):") + 1]

    round_tripped_transcript = json.loads(transcript_line)
    assert round_tripped_transcript == fixture_input["transcript"]["text"]
    assert "ignore previous instructions" in round_tripped_transcript
    assert "{curly braces}" in round_tripped_transcript
    assert '"double quotes"' in round_tripped_transcript
    assert "```" in round_tripped_transcript

    round_tripped_offsets = json.loads(offsets_line)
    assert round_tripped_offsets == {
        "fromOffsetMs": fixture_input["transcript"]["fromOffsetMs"],
        "toOffsetMs": fixture_input["transcript"]["toOffsetMs"],
    }

    round_tripped_slides = json.loads(slides_line)
    assert round_tripped_slides == fixture_input["slides"]

    # The untrusted phrase must never appear unescaped/raw outside the one
    # JSON string token it was rendered into.
    raw_occurrences = len(re.findall(r"(?<!\\)ignore previous instructions", rendered))
    assert raw_occurrences == 1


def test_render_uses_the_supplied_count_bounds() -> None:
    fixture_input = _load_fixture_input()
    rendered = _render_user_prompt(fixture_input)
    assert "Create between 3 and 5 MCQs." in rendered


def test_system_prompt_forbids_ids_and_treats_source_text_as_untrusted() -> None:
    content = SYSTEM_MD.read_text()
    assert "ids" in content
    assert "untrusted" in content
    assert "3 to 5" in content
    assert "2 to 4" in content


# --- schema/grammar structural agreement -------------------------------------


@pytest.mark.parametrize("question_count", [3, 4, 5])
def test_valid_batches_are_accepted_by_schema_and_grammar(question_count: int) -> None:
    schema = _load_schema()
    batch = _valid_batch(question_count)
    assert _schema_accepts(schema, batch)
    assert _gbnf_accepts(batch)


@pytest.mark.parametrize("question_count", [2, 6])
def test_out_of_range_question_count_is_rejected(question_count: int) -> None:
    schema = _load_schema()
    batch = _valid_batch(question_count)
    assert not _schema_accepts(schema, batch)
    assert not _gbnf_accepts(batch)


@pytest.mark.parametrize("option_count", [1, 5])
def test_out_of_range_option_count_is_rejected(option_count: int) -> None:
    schema = _load_schema()
    batch = _valid_batch(3)
    batch[0] = _question("question 0?", _valid_options(option_count, 0))
    assert not _schema_accepts(schema, batch)
    assert not _gbnf_accepts(batch)


def test_zero_correct_options_is_rejected() -> None:
    schema = _load_schema()
    batch = _valid_batch(3)
    batch[0] = _question("question 0?", [("a", False), ("b", False)])
    assert not _schema_accepts(schema, batch)
    assert not _gbnf_accepts(batch)


def test_two_correct_options_is_rejected() -> None:
    schema = _load_schema()
    batch = _valid_batch(3)
    batch[0] = _question("question 0?", [("a", True), ("b", True)])
    assert not _schema_accepts(schema, batch)
    assert not _gbnf_accepts(batch)


def test_blank_option_text_is_rejected_by_schema_but_grammar_has_no_length_rule() -> None:
    schema = _load_schema()
    batch = _valid_batch(3)
    batch[0] = _question("question 0?", [("", True), ("b", False)])
    assert not _schema_accepts(schema, batch)
    # The grammar's `char*` production permits an empty string — the length
    # floor is Pydantic/schema defense in depth, not a grammar guarantee.
    assert _gbnf_accepts(batch)


def test_overlong_option_text_is_rejected_by_schema_but_grammar_has_no_length_rule() -> None:
    schema = _load_schema()
    batch = _valid_batch(3)
    batch[0] = _question("question 0?", [("a" * 513, True), ("b", False)])
    assert not _schema_accepts(schema, batch)
    assert _gbnf_accepts(batch)


def test_duplicate_options_pass_schema_and_grammar_but_are_flagged_downstream() -> None:
    schema = _load_schema()
    batch = _valid_batch(3)
    batch[0] = _question("question 0?", [("Energy", True), ("  energy  ", False)])
    # Near-duplicate casefolded text remains parser validation (C-07) because
    # JSON Schema — and this grammar — cannot express it honestly.
    assert _schema_accepts(schema, batch)
    assert _gbnf_accepts(batch)
    assert _has_near_duplicate_options(batch)


# --- version immutability ----------------------------------------------------


def test_shipped_v1_assets_are_pinned_by_digest() -> None:
    actual = {
        "system.md": _sha256_of(SYSTEM_MD),
        "user.md.j2": _sha256_of(USER_TEMPLATE),
        "grammar.gbnf": _sha256_of(GRAMMAR),
        "schema.json": _sha256_of(SCHEMA),
    }
    assert actual == EXPECTED_DIGESTS, (
        "A shipped mcq/v1 asset changed. Prompt versions are immutable once "
        "shipped (ai-services.md §3.2): create prompts/mcq/v2/ and a new "
        "CHANGELOG.md entry instead of editing v1 in place."
    )


def test_changelog_records_v1_provenance() -> None:
    content = CHANGELOG.read_text()
    assert content.startswith(
        "mcq/v1 — initial v1.0.0 MCQ prompt; 3–5 questions, 2–4 options, exactly one correct."
    )
