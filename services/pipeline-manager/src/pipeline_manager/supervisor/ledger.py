from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterator, Literal

# The encode ledger admits two guaranteed video encodes plus one provisional
# thumbnail encode (design §4.1) — record/live guarantees are never displaced.
GUARANTEED_CAPACITY = 2
TOTAL_CAPACITY = 3

Priority = Literal["guaranteed", "provisional"]


class EncoderBudgetExceeded(RuntimeError):
    pass


class AlreadyReserved(ValueError):
    pass


@dataclass
class Reservation:
    owner: str
    slots: int
    priority: Priority
    committed: bool = False

    def commit(self) -> None:
        self.committed = True


@dataclass
class EncodeLedger:
    capacity: int = TOTAL_CAPACITY
    guaranteed_capacity: int = GUARANTEED_CAPACITY
    _reservations: dict[str, Reservation] = field(default_factory=dict)

    @property
    def in_use(self) -> int:
        return sum(r.slots for r in self._reservations.values())

    def reserved_by(self) -> tuple[str, ...]:
        return tuple(self._reservations.keys())

    @contextmanager
    def reserve(self, owner: str, slots: int, priority: Priority = "guaranteed") -> Iterator[Reservation]:
        """Convenience for a reservation scoped to one `with` block. Consumers
        whose reservation must outlive a single block (held from before spawn
        until the consumer's terminal state) should call `acquire()`/`release()`
        directly instead — this context manager is built on exactly those.
        """
        reservation = self.acquire(owner, slots, priority)
        try:
            yield reservation
        finally:
            self.release(owner)

    def acquire(self, owner: str, slots: int, priority: Priority) -> Reservation:
        """Reserve before spawn; call `.commit()` on the result after spawn
        succeeds. Release on every terminal path (including spawn/confirm
        failure) via `release(owner)`."""
        if owner in self._reservations:
            raise AlreadyReserved(f"{owner} already holds a reservation")

        if priority == "guaranteed":
            guaranteed_in_use = sum(
                r.slots for r in self._reservations.values() if r.priority == "guaranteed"
            )
            if guaranteed_in_use + slots > self.guaranteed_capacity:
                raise EncoderBudgetExceeded("encoder_budget_exceeded")
        else:
            provisional_capacity = self.capacity - self.guaranteed_capacity
            provisional_in_use = sum(
                r.slots for r in self._reservations.values() if r.priority == "provisional"
            )
            if provisional_in_use + slots > provisional_capacity:
                raise EncoderBudgetExceeded("encoder_budget_exceeded")

        if self.in_use + slots > self.capacity:
            raise EncoderBudgetExceeded("encoder_budget_exceeded")

        reservation = Reservation(owner=owner, slots=slots, priority=priority)
        self._reservations[owner] = reservation
        return reservation

    def release(self, owner: str) -> None:
        self._reservations.pop(owner, None)
