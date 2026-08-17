from __future__ import annotations

from dataclasses import dataclass, field

from pipeline_manager.supervisor.process import ManagedProcess


@dataclass
class FakeStdin:
    written: list = field(default_factory=list)

    def write(self, data: bytes) -> None:
        self.written.append(data)

    def flush(self) -> None:
        pass


@dataclass
class FakePopen:
    returncode: int | None = 0
    stdin: FakeStdin = field(default_factory=FakeStdin)

    def wait(self, timeout: float | None = None) -> int:
        return self.returncode


@dataclass
class FakeSupervisor:
    calls: list = field(default_factory=list)
    next_pid: int = 2000

    async def start(self, spec, identity):
        process = ManagedProcess(identity=identity, pid=self.next_pid, pgid=self.next_pid, popen=FakePopen())
        self.calls.append((spec, identity))
        self.next_pid += 1
        return process


@dataclass
class FakeConfirmer:
    exc: Exception | None = None
    calls: list = field(default_factory=list)

    async def confirm(self, process, **kwargs):
        self.calls.append((process, kwargs))
        if self.exc is not None:
            raise self.exc


@dataclass
class SignalSpy:
    calls: list = field(default_factory=list)

    def __call__(self, pgid: int, sig: int) -> None:
        self.calls.append((pgid, sig))
