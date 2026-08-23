"""LAN llama.cpp reachability probe (ai-services.md §3.4, Q-06 recovery loop).

Always resolves to an HTTP 200 with `{reachable, latencyMs, model?}` — an
unreachable LLM is a normal probe *result*, not a service failure, so B's
recovery loop can keep polling without special-casing transport errors.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import httpx

PROBE_TIMEOUT = httpx.Timeout(connect=5.0, read=5.0, write=5.0, pool=5.0)


@dataclass(frozen=True)
class ProbeResult:
    reachable: bool
    latencyMs: float | None
    model: str | None = None


def _extract_model(response: httpx.Response) -> str | None:
    try:
        payload = response.json()
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    model = payload.get("model")
    return model if isinstance(model, str) and model else None


async def probe(
    http_client: httpx.AsyncClient,
    llm_endpoint: str,
    *,
    clock: Callable[[], float] = time.monotonic,
) -> ProbeResult:
    base = llm_endpoint.rstrip("/")

    start = clock()
    try:
        response = await http_client.get(f"{base}/health", timeout=PROBE_TIMEOUT)
    except httpx.TransportError:
        return ProbeResult(reachable=False, latencyMs=None)

    if response.status_code // 100 == 2:
        return ProbeResult(reachable=True, latencyMs=(clock() - start) * 1000, model=_extract_model(response))

    if response.status_code in (404, 405):
        fallback_start = clock()
        try:
            fallback = await http_client.post(
                f"{base}/completion", json={"prompt": "", "n_predict": 1}, timeout=PROBE_TIMEOUT
            )
        except httpx.TransportError:
            return ProbeResult(reachable=False, latencyMs=None)
        if fallback.status_code // 100 == 2:
            return ProbeResult(reachable=True, latencyMs=(clock() - fallback_start) * 1000)
        return ProbeResult(reachable=False, latencyMs=None)

    return ProbeResult(reachable=False, latencyMs=None)
