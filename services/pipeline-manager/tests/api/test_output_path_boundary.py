from __future__ import annotations

import os
import sys

import pytest

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
