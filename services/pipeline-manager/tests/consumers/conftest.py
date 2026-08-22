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
    # `None` means "still running" — a freshly spawned fake child must read as
    # alive to the exit watcher until a test explicitly simulates an exit via
    # `popen.returncode = <code>` (mirrors real `Popen.poll()`/`.wait()`).
    returncode: int | None = None
    stdin: FakeStdin = field(default_factory=FakeStdin)
    stdout: object | None = None
    stderr: object | None = None

    def wait(self, timeout: float | None = None) -> int:
        if self.returncode is None:
            self.returncode = 0
        return self.returncode

    def poll(self) -> int | None:
        return self.returncode


@dataclass
class FakeSupervisor:
    calls: list = field(default_factory=list)
    next_pid: int = 2000
    processes: dict = field(default_factory=dict)

    async def start(self, spec, identity):
        process = ManagedProcess(identity=identity, pid=self.next_pid, pgid=self.next_pid, popen=FakePopen())
        self.calls.append((spec, identity))
        self.processes[identity] = process
        self.next_pid += 1
        return process

    def forget(self, identity: str) -> None:
        self.processes.pop(identity, None)


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
