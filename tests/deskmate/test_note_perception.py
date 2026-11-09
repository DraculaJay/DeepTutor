"""Same-page sharing, cross-page isolation and the real context protocol boundary."""
import json
from pathlib import Path
import pytest
from deeptutor.co_writer.storage import CoWriterStorage
from deeptutor.services.path_service import PathService
from deeptutor.deskmate.service import DeskmateService
from deeptutor.deskmate.storage import HostCourses
from deeptutor.deskmate.tool import ScreenContextTool
from deeptutor.deskmate.vendor.jarvis_backend.native import InProcessNativeClient
from deeptutor.video_learning.service import TimedMediaStore

class ContextNative(InProcessNativeClient):
    def __init__(self):
        super().__init__()
        self.contexts = []
    async def request(self, method, payload):
        if method == 'set_learning_context':
            self.contexts.append(json.loads(payload['text']))
            return {'ok': True, 'context_revision': len(self.contexts)}
        return await super().request(method, payload)

@pytest.mark.asyncio
async def test_note_and_turn_share_context_without_rewriting_the_document(tmp_path, monkeypatch):
    from deeptutor.co_writer import storage as documents
    from deeptutor.deskmate import service as services
    storage = CoWriterStorage(PathService(tmp_path / 'data'))
    monkeypatch.setattr(documents, 'get_co_writer_storage', lambda: storage)
    doc = storage.create_document(title='矩阵变换', content='关注旋转方向与角度。')
    native = ContextNative()
    service = DeskmateService(native, HostCourses(TimedMediaStore(tmp_path / 'media'), 'capture'), 'capture', note_document_id=doc.id)
    monkeypatch.setattr(services, 'current_service', lambda: service)
    await service.start()
    try:
        await service.sync_note_context()
        await service.sync_note_context(session_id='question-a', question='为什么逆时针？')
        await service.sync_note_context(session_id='question-a', answer='旋转方向来自矩阵中正弦项的符号。')
        assert native.contexts[-1]['note_document_id'] == doc.id
        assert native.contexts[-1]['question'] == '为什么逆时针？'
        assert '正弦' in native.contexts[-1]['answer']
        assert native.contexts[-1]['note_excerpt'] == doc.content
        service.snapshot['latest_observation'] = '课件显示旋转矩阵。'
        assert '旋转矩阵' in services.note_perception_context(doc.id)
        assert not services.note_perception_context('f' * 16)
        # A second question in another thread on this page can read the same observations.
        result = await ScreenContextTool().execute(_deskmate_session_id='question-b', _deskmate_note_document_id=doc.id)
        assert '旋转矩阵' in result.content
        denied = await ScreenContextTool().execute(_deskmate_session_id='capture', _deskmate_note_document_id='f' * 16)
        assert 'not active' in denied.content
        assert storage.load_document(doc.id).model_dump() == doc.model_dump()
        # An older thread's late answer cannot overwrite a newer thread's focus.
        await service.sync_note_context(session_id='question-b', question='现在看缩放。')
        await service.sync_note_context(session_id='question-a', answer='旧回答')
        assert native.contexts[-1]['question'] == '现在看缩放。'
        assert native.contexts[-1]['answer'] != '旧回答'
    finally:
        await service.stop()

@pytest.mark.asyncio
async def test_native_context_ack_and_wire_keep_utf8_json(monkeypatch):
    import io
    from deeptutor.deskmate.vendor.jarvis_backend.native.client import NamedPipeNativeClient
    from deeptutor.deskmate.vendor.jarvis_backend.native.protocol import decode_frame, MessageType
    client = NamedPipeNativeClient('unused')
    client.running = True
    client._stream = io.BytesIO()
    frames = []
    def write(raw):
        frame = decode_frame(raw)
        frames.append(frame)
        client._pending[frame.request_id].set_result({'ok': True, 'context_revision': 7})
    monkeypatch.setattr(client, '_write_exact', write)
    result = await client.request('set_learning_context', {'text': json.dumps({'note_title': '矩阵'}, ensure_ascii=False)})
    assert frames[0].message_type == MessageType.LEARNING_CONTEXT
    assert json.loads(frames[0].payload)['note_title'] == '矩阵'
    assert result['context_revision'] == 7
