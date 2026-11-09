"""Reuse Jarvis's framing and RPC dispatch over a private Unix socket."""
from __future__ import annotations
import asyncio
from contextlib import suppress
from pathlib import Path
import shutil
import socket
import tempfile
from .vendor.jarvis_backend.native.client import NamedPipeNativeClient
from .vendor.jarvis_backend.native.protocol import Frame, MessageType, encode_frame


class UnixNativeClient(NamedPipeNativeClient):
    def __init__(self, worker: Path, model_path: str = ''):
        self.directory = tempfile.mkdtemp(prefix='dt-desk-', dir='/tmp')
        super().__init__(str(Path(self.directory) / 'worker.sock'), timeout=120)
        self.worker, self.model_path = worker, model_path
        self.process = None
        self.socket = None

    async def start(self):
        args = [str(self.worker), self.pipe_name]
        if self.model_path:
            args.append(self.model_path)
        self.process = await asyncio.create_subprocess_exec(*args)
        try:
            async with asyncio.timeout(120):
                while not Path(self.pipe_name).exists():
                    if self.process.returncode is not None:
                        raise RuntimeError(f'Native worker exited with {self.process.returncode}; see desktop log')
                    await asyncio.sleep(.05)
            self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            await asyncio.to_thread(self.socket.connect, self.pipe_name)
            self._stream = self.socket.makefile('rwb', buffering=0)
            self.running = True
            self._reader_task = asyncio.create_task(self._read_loop(), name='deskmate-native-reader')
            await self.request('ping', {})
        except BaseException:
            await self.stop()
            raise

    async def reply(self, request_id: int, text: str):
        async with self._write_lock:
            await asyncio.to_thread(self._write_exact, encode_frame(Frame(MessageType.RESULT, request_id, text.encode())))

    async def stop(self):
        if self.socket:
            with suppress(OSError):
                self.socket.shutdown(socket.SHUT_RDWR)
            self.socket.close()
            self.socket = None
        # The inherited reader marks running=False on EOF; still close its resources.
        self.running = True
        await super().stop()
        if self.process and self.process.returncode is None:
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except TimeoutError:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), 5)
                except TimeoutError:
                    self.process.kill()
                    await self.process.wait()
        if Path(self.directory).exists():
            shutil.rmtree(self.directory)
