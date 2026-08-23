from __future__ import annotations

from pathlib import Path

from slide_service.dedupe import FinalizedCandidate, SlideCandidateMachine

from fixtures.slides import make_animation_build, make_slide


def _make_machine(tmp_path: Path, **kwargs) -> SlideCandidateMachine:
    temp_dir = tmp_path / "candidates"
    temp_dir.mkdir()
    return SlideCandidateMachine(temp_dir=temp_dir, **kwargs)


class TestThreshold:
    def test_near_duplicate_replaces_candidate_without_finalizing(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        frame1 = tmp_path / "f1.png"
        frame2 = tmp_path / "f2.png"
        make_slide(frame1, title="Title Slide", lines=["Point one"])
        make_slide(frame2, title="Title Slide", lines=["Point one", "Point two"])

        assert machine.observe(frame1, 1000) is None
        assert machine.observe(frame2, 2000) is None  # near-duplicate, same slide

    def test_distinct_frame_finalizes_prior_candidate(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        title_slide = tmp_path / "title.png"
        make_slide(title_slide, title="Conservation of Energy")
        second_slide = tmp_path / "second.png"
        make_slide(
            second_slide,
            title="Entropy And Disorder",
            lines=["A totally different topic block"] * 4,
            bg=(20, 20, 20),
        )

        assert machine.observe(title_slide, 1000) is None
        finalized = machine.observe(second_slide, 5000)

        assert isinstance(finalized, FinalizedCandidate)
        assert finalized.observed_offset_ms == 1000
        assert finalized.source_path.read_bytes() == title_slide.read_bytes()
        assert finalized.dedupe_hash

    def test_previous_temporary_candidate_is_deleted_on_replace(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        frame1 = tmp_path / "f1.png"
        frame2 = tmp_path / "f2.png"
        make_slide(frame1, title="Title Slide", lines=["Point one"])
        make_slide(frame2, title="Title Slide", lines=["Point one", "Point two"])

        machine.observe(frame1, 1000)
        before = list((tmp_path / "candidates").iterdir())
        machine.observe(frame2, 2000)
        after = list((tmp_path / "candidates").iterdir())

        assert len(before) == 1
        assert len(after) == 1
        assert before[0] != after[0]


class TestAnimationSequence:
    def test_finalized_first_slide_is_fullest_frame(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        bullets = ["First point appears", "Second point appears", "Third point appears"]
        frames = []
        for revealed in (1, 2, 3):
            frame = tmp_path / f"build-{revealed}.png"
            make_animation_build(frame, title="Title Slide", bullets=bullets, revealed=revealed)
            frames.append(frame)

        for offset, frame in enumerate(frames):
            result = machine.observe(frame, offset * 1000)
            assert result is None  # all three stay pending as one evolving candidate

        distinct_next = tmp_path / "next.png"
        make_slide(
            distinct_next, title="Completely Different Topic", lines=["Nothing shared here"] * 4, bg=(20, 20, 20)
        )
        finalized = machine.observe(distinct_next, 10_000)

        assert finalized is not None
        assert finalized.source_path.read_bytes() == frames[-1].read_bytes()


class TestEndOfSession:
    def test_finalize_pending_returns_and_clears_exactly_one_candidate(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        frame = tmp_path / "only.png"
        make_slide(frame, title="Only Slide")
        machine.observe(frame, 500)

        finalized = machine.finalize_pending()
        assert finalized is not None
        assert finalized.observed_offset_ms == 500

        assert machine.finalize_pending() is None  # nothing left to clear

    def test_finalize_pending_with_no_observation_is_none(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        assert machine.finalize_pending() is None


class TestCandidateIsolation:
    def test_candidate_copy_survives_source_mutation(self, tmp_path: Path) -> None:
        machine = _make_machine(tmp_path)
        source = tmp_path / "current.png"
        make_slide(source, title="Original")
        machine.observe(source, 0)
        original_bytes = source.read_bytes()

        make_slide(source, title="Mutated After Copy")  # simulates the next atomic replace
        finalized = machine.finalize_pending()

        assert finalized is not None
        assert finalized.source_path.read_bytes() == original_bytes
