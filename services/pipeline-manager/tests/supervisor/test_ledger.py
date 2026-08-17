from __future__ import annotations

import pytest

from pipeline_manager.supervisor.ledger import AlreadyReserved, EncodeLedger, EncoderBudgetExceeded


def test_capacity_is_three() -> None:
    ledger = EncodeLedger()
    assert ledger.capacity == 3


def test_two_guaranteed_reservations_succeed() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("record:1", 1, "guaranteed"):
        with ledger.reserve("live:1", 1, "guaranteed"):
            assert ledger.in_use == 2


def test_third_guaranteed_reservation_rejected() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("record:1", 1, "guaranteed"), ledger.reserve("live:1", 1, "guaranteed"):
        with pytest.raises(EncoderBudgetExceeded):
            with ledger.reserve("record:2", 1, "guaranteed"):
                pass


def test_thumbnail_cannot_displace_a_guaranteed_slot() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("record:1", 1, "guaranteed"), ledger.reserve("live:1", 1, "guaranteed"):
        # Both guaranteed slots are held; thumbnail may only use the provisional third.
        with ledger.reserve("thumbnail:1", 1, "provisional") as reservation:
            assert reservation.priority == "provisional"
            assert ledger.in_use == 3


def test_two_thumbnails_cannot_both_fit_in_the_one_provisional_slot() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("thumbnail:1", 1, "provisional"):
        with pytest.raises(EncoderBudgetExceeded):
            with ledger.reserve("thumbnail:2", 1, "provisional"):
                pass


def test_fourth_start_returns_encoder_budget_exceeded_without_spawning() -> None:
    ledger = EncodeLedger()
    spawned = []
    with ledger.reserve("record:1", 1, "guaranteed"):
        spawned.append("record:1")
        with ledger.reserve("live:1", 1, "guaranteed"):
            spawned.append("live:1")
            with ledger.reserve("thumbnail:1", 1, "provisional"):
                spawned.append("thumbnail:1")
                with pytest.raises(EncoderBudgetExceeded):
                    with ledger.reserve("thumbnail:2", 1, "provisional"):
                        spawned.append("thumbnail:2")  # must never run
    assert spawned == ["record:1", "live:1", "thumbnail:1"]


def test_reservation_releases_on_context_exit() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("record:1", 1, "guaranteed"):
        assert ledger.in_use == 1
    assert ledger.in_use == 0
    assert ledger.reserved_by() == ()


def test_reservation_releases_even_when_body_raises() -> None:
    ledger = EncodeLedger()
    with pytest.raises(RuntimeError):
        with ledger.reserve("record:1", 1, "guaranteed"):
            raise RuntimeError("spawn failed")
    assert ledger.in_use == 0


def test_commit_marks_reservation_committed() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("record:1", 1, "guaranteed") as reservation:
        assert reservation.committed is False
        reservation.commit()
        assert reservation.committed is True


def test_duplicate_owner_rejected() -> None:
    ledger = EncodeLedger()
    with ledger.reserve("record:1", 1, "guaranteed"):
        with pytest.raises(AlreadyReserved):
            with ledger.reserve("record:1", 1, "guaranteed"):
                pass
