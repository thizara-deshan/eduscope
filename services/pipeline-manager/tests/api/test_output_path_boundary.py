from __future__ import annotations

import os
import subprocess
import sys

import pytest

from pipeline_manager.app import create_app
from pipeline_manager.config import Settings

from .conftest import VALID_TOKEN, make_fake_popen

"""B1 (A-REV-002/A-REV-016) boundary tests: `resolve_output_path` runs inside
the record/snapshot routes before a consumer id is registered or anything is
spawned. Every case here must produce a Problem-shaped 4xx *and* prove
nothing was registered or spawned — a route that validated-then-spawned-anyway
would still pass a naive status-code-only assertion.
"""


def _assert_rejected_and_no_spawn(app, response, *, expected_status: int = 400) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert body["code"] == "invalid_output_path"
    assert body["status"] == expected_status
    assert app.state.consumers == {}
    assert app.state.supervisor.processes == {}


@pytest.mark.asyncio
async def test_record_relative_path_rejected(app, client, auth_headers) -> None:
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": "relative/segment.ts"},
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
async def test_record_outside_root_rejected(app, client, auth_headers) -> None:
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": "/etc/passwd"},
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
async def test_record_dotdot_escape_rejected(app, client, auth_headers, tmp_path) -> None:
    escape_path = str(tmp_path / ".." / "outside.ts")
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": escape_path},
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
async def test_record_duplicate_output_targets_rejected(app, client, auth_headers, tmp_path) -> None:
    same_path = str(tmp_path / "same.ts")
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={
            "preset": "separate-files",
            "outputPaths": {"presentation": same_path, "lecturer-cam": same_path},
        },
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="symlink escape needs a real POSIX symlink; verified on target")
async def test_record_symlink_escape_rejected(app, client, auth_headers, tmp_path) -> None:
    """`root/link -> outside` with `outputPath=root/link/escape.ts` normalizes
    to a string that still looks like it's under root; only following the
    real symlink (`os.path.realpath`) exposes the escape."""
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    link = tmp_path / "link"
    os.symlink(outside, link, target_is_directory=True)

    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": str(link / "escape.ts")},
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
async def test_record_root_itself_rejected(app, client, auth_headers, tmp_path) -> None:
    response = await client.post(
        "/consumers/record",
        headers=auth_headers,
        json={"preset": "cam-1", "outputPath": str(tmp_path)},
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
async def test_snapshot_outside_root_rejected(app, client, auth_headers) -> None:
    response = await client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": "/etc/slides.png"},
    )
    _assert_rejected_and_no_spawn(app, response)


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="symlink escape needs a real POSIX symlink; verified on target")
async def test_snapshot_tmp_sibling_escape_rejected(app, client, auth_headers, tmp_path) -> None:
    """The pipeline writes to `<outputPath>.tmp` before the atomic rename
    (`publish_snapshot`); if the *final* path escaped through a symlink, the
    `.tmp` sibling would too. Validating `outputPath` up front (B-02) is the
    one boundary check protecting both — assert it actually catches an
    escape reachable only through a symlinked directory.
    """
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    link = tmp_path / "link"
    os.symlink(outside, link, target_is_directory=True)

    response = await client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": str(link / "slide.png")},
    )
    _assert_rejected_and_no_spawn(app, response)


# ── C execution gate item 1: tmpfs slide snapshot source ───────────────────
#
# `/run/eduscope/slides/<sessionId>/current.png` is the approved atomic tmpfs
# capture source slide-service watches (see the C execution gate note in
# docs/plans/integration-plan.md). It sits outside `recordings_root`, so it
# must be accepted through a dedicated, symlink-aware branch rather than by
# loosening the recordings-root boundary itself.


@pytest.fixture
async def runtime_app(tmp_path):
    recordings_root = tmp_path / "recordings"
    recordings_root.mkdir()
    runtime_root = tmp_path / "run"
    runtime_root.mkdir()
    settings = Settings(shared_bearer_token=VALID_TOKEN, recordings_root=recordings_root, runtime_root=runtime_root)
    app = create_app(settings, popen=make_fake_popen())
    yield app
    for process in app.state.supervisor.processes.values():
        if process.popen.poll() is None:
            process.popen.terminate()
    for process in app.state.supervisor.processes.values():
        try:
            process.popen.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.popen.kill()
            process.popen.wait(timeout=5)


@pytest.fixture
async def runtime_client(runtime_app):
    import httpx

    transport = httpx.ASGITransport(app=runtime_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.mark.asyncio
async def test_snapshot_tmpfs_source_accepted(runtime_app, runtime_client, auth_headers) -> None:
    tmpfs_path = runtime_app.state.settings.runtime_root / "slides" / "01J00000000000000000000000" / "current.png"
    response = await runtime_client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": str(tmpfs_path)},
    )
    assert response.status_code == 202
    assert len(runtime_app.state.consumers) == 1


@pytest.mark.asyncio
async def test_snapshot_outside_both_roots_rejected(runtime_app, runtime_client, auth_headers) -> None:
    response = await runtime_client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": "/etc/slides.png"},
    )
    _assert_rejected_and_no_spawn(runtime_app, response)


@pytest.mark.asyncio
@pytest.mark.skipif(sys.platform == "win32", reason="symlink escape needs a real POSIX symlink; verified on target")
async def test_snapshot_tmpfs_symlink_escape_rejected(runtime_app, runtime_client, auth_headers, tmp_path) -> None:
    """`<runtime_root>/slides/link -> outside` with
    `outputPath=<runtime_root>/slides/link/current.png` has the exact
    `<session-id>/current.png` shape lexically, but the real symlink target
    is outside the slides root — only following it exposes the escape."""
    slides_root = runtime_app.state.settings.runtime_root / "slides"
    slides_root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    link = slides_root / "link"
    os.symlink(outside, link, target_is_directory=True)

    response = await runtime_client.post(
        "/consumers/snapshot/start",
        headers=auth_headers,
        json={"intervalSec": 5, "outputPath": str(link / "current.png")},
    )
    _assert_rejected_and_no_spawn(runtime_app, response)
