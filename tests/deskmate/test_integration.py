"""Adapter unit tests use explicit fixtures; they do not validate capture or model quality."""
import base64
import json

import pytest

from deeptutor.deskmate.service import DeskmateService
from deeptutor.deskmate.storage import HostCourses
from deeptutor.deskmate.vendor.jarvis_backend.native import InProcessNativeClient
from deeptutor.runtime.registry.tool_registry import ToolRegistry
from deeptutor.video_learning.service import TimedMediaStore


class FixtureNative(InProcessNativeClient):
    async def request(self, method, payload):
        if method == 'snapshot':
            frame = {'width': 1, 'height': 1, 'row_pitch': 4, 'bgra': base64.b64encode(b'\x00\x00\xff\xff').decode()}
            return {'ok': True, 'text': json.dumps(frame)}
        return await super().request(method, payload)


def course_event(text='The generator is consumed once.'):
    return {'type': 'perception.completed', 'text': json.dumps({
        'scene': 'course', 'confidence': .99, 'observation': 'Python course slide',
        'course_title': 'Python generators', 'course_transcript': text,
        'course_note': '', 'course_interaction': '', 'capture_keyframe': True,
        'keyframe_note': 'generator example', 'assistant_message': '',
    })}


def test_tool_is_registered_in_existing_registry():
    registry = ToolRegistry()
    registry.load_builtins()
    tool = registry.get('screen_context')
    assert tool is not None
    assert tool.get_definition().to_openai_schema()['function']['name'] == 'screen_context'


@pytest.mark.asyncio
async def test_course_reuses_host_identity_and_attachment_storage(tmp_path, monkeypatch):
    from deeptutor.services import storage
    from deeptutor.services.storage import LocalDiskAttachmentStore
    attachments = LocalDiskAttachmentStore(tmp_path / 'attachments')
    monkeypatch.setattr(storage, 'get_attachment_store', lambda: attachments)
    courses = HostCourses(TimedMediaStore(tmp_path / 'timed_media'), 'host-session')
    service = DeskmateService(FixtureNative(), courses, 'host-session')
    await service.start()
    try:
        await service._on_native_event(course_event())
        await service._on_native_event(course_event())
        course = courses.open('host-session')
        assert course.state.id == 'host-session'
        assert course.material['source']['session_id'] == 'host-session'
        assert course.material['transcript']['cues'][0]['source'] == 'system_audio'
        assert len(list((tmp_path / 'timed_media').glob('*.json'))) == 1
        assert course.state.keyframes
        frame = course.state.keyframes[0]
        assert attachments.resolve_path(session_id='host-session', attachment_id=frame['attachment_id'], filename=frame['filename']).is_file()
        assert service.snapshot['course']['id'] == 'host-session'
        assert service.snapshot['recent_transcript']
        assert service.memory.events()  # bounded transient buffer, no Jarvis files
        assert not list(tmp_path.rglob('state.json'))
        assert not list(tmp_path.rglob('transcript.md'))
    finally:
        await service.stop()


@pytest.mark.asyncio
async def test_summary_uses_teaching_provider_and_existing_cowriter(tmp_path, monkeypatch):
    from deeptutor.services import llm
    from deeptutor.co_writer import storage
    from deeptutor.services.path_service import PathService
    writer = storage.CoWriterStorage(PathService(tmp_path / 'data'))
    monkeypatch.setattr(storage, 'get_co_writer_storage', lambda: writer)
    calls = []
    async def teaching_fixture(prompt, **kwargs):
        calls.append(prompt)
        return '## Fixture summary\nA generator is consumed once.'
    monkeypatch.setattr(llm, 'complete', teaching_fixture)
    courses = HostCourses(TimedMediaStore(tmp_path / 'timed_media'), 'host-session')
    courses.create('Generators', session_id='auto-ignored')
    courses.open('host-session').append_transcript('A generator is consumed once.')
    service = DeskmateService(FixtureNative(), courses, 'host-session')
    state = await service.finish_course('host-session')
    assert state.status.value == 'finalizing'
    await service.summary_tasks['host-session']
    finished = courses.open('host-session').state
    assert finished.status.value == 'complete'
    assert writer.load_document(finished.output_path).content.startswith('## Fixture summary')
    assert calls and 'A generator is consumed once.' in calls[0]
    # The original NativeClient was never started: summaries did not use Omni.
    assert not service.native_client.running
    assert service.course_finished


@pytest.mark.asyncio
async def test_screen_tool_rejects_another_learning_session(tmp_path, monkeypatch):
    from deeptutor.deskmate import service as services
    from deeptutor.deskmate.tool import ScreenContextTool
    service = DeskmateService(FixtureNative(), HostCourses(TimedMediaStore(tmp_path), 'session-a'), 'session-a')
    await service.start()
    monkeypatch.setattr(services, 'current_service', lambda: service)
    try:
        result = await ScreenContextTool().execute(_deskmate_session_id='session-b')
        assert 'not active' in result.content
        service.capture_ready = True
        result = await ScreenContextTool().execute(_deskmate_session_id='session-a')
        assert result.model_message['content'][1]['image_url']['url'].startswith('data:image/png;base64,')
        assert 'bgra' not in result.content
    finally:
        await service.stop()


@pytest.mark.asyncio
async def test_empty_provider_response_preserves_recording_as_failed(tmp_path, monkeypatch):
    from deeptutor.services import llm
    async def empty_response(prompt, **kwargs):
        return ''
    monkeypatch.setattr(llm, 'complete', empty_response)
    courses = HostCourses(TimedMediaStore(tmp_path), 'empty-response-session')
    courses.create('Generators')
    courses.open('empty-response-session').append_transcript('A generator is consumed once.')
    service = DeskmateService(FixtureNative(), courses, 'empty-response-session')
    await service.finish_course('empty-response-session')
    await service.summary_tasks['empty-response-session']
    state = courses.open('empty-response-session').state
    assert state.status.value == 'failed'
    assert 'empty summary' in state.error
    assert state.output_path is None
    assert courses.open('empty-response-session').transcript_path.read_text()
