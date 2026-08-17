from __future__ import annotations


class DomainProblem(Exception):
    """Base for every typed domain error the API converts through one
    exception handler into `{code, title, status, meta}` (design §3.4).
    """

    def __init__(self, code: str, title: str, status: int, meta: dict | None = None) -> None:
        super().__init__(title)
        self.code = code
        self.title = title
        self.status = status
        self.meta = meta


class InvalidPresetString(DomainProblem):
    def __init__(self, value: str) -> None:
        super().__init__("invalid_preset", "Unknown preset", 400, {"preset": value})


class NegotiationNotFound(DomainProblem):
    def __init__(self, negotiation_id: str) -> None:
        super().__init__("consumer_not_found", "Unknown negotiation", 404, {"negotiationId": negotiation_id})
