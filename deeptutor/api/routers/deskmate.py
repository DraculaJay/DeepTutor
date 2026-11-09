"""Local desktop controls, under DeepTutor's existing learning auth policy."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from deeptutor.services.llm.exceptions import LLMError
from deeptutor.deskmate.service import current_service, start_service, start_note_service


def local_desktop(request: Request):
    if request.client and request.client.host not in {'127.0.0.1', '::1', 'testclient'}:
        raise HTTPException(403, 'Desktop perception is only available on this Mac')


router = APIRouter(dependencies=[Depends(local_desktop)])


class StartRequest(BaseModel):
    session_id: str | None = Field(default=None, min_length=1, max_length=128)
    note_document_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{8,32}$")


@router.get('/status')
async def status():
    service = current_service()
    if not service:
        return {'state': 'stopped', 'connected': False, 'capture_ready': False, 'error': ''}
    bubbles = [e.payload.get('text', '') for e in service.events.history()
               if e.topic in {'assistant.message', 'course.interaction', 'barrage.generated'}]
    return {'state': service.lifecycle.snapshot.state.value, 'connected': service.native_connected,
            'capture_ready': service.capture_ready, 'system_audio_ready': service.system_audio_ready, 'monitoring': service._monitoring_requested,
            'runtime': 'omni' if service.omni else 'deeptutor-byok',
            'context': service.snapshot, 'error': service.error, 'messages': bubbles[-3:]}


@router.post('/start')
async def start(body: StartRequest):
    try:
        if body.note_document_id:
            await start_note_service(body.note_document_id, body.session_id)
        elif body.session_id:
            await start_service(body.session_id)
        else:
            raise ValueError("Choose a notebook page or learning conversation first")
        return await status()
    except (RuntimeError, ValueError, OSError, LLMError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post('/stop')
async def stop():
    service = current_service()
    if service:
        await service.stop()
    return await status()


@router.post('/course/finish')
async def finish_course():
    service = current_service()
    if not service:
        raise HTTPException(409, 'No active learning session')
    try:
        return (await service.finish_course(service.session_id)).as_dict()
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get('/events')
async def events():
    service = current_service()
    return [{'id': e.id, 'topic': e.topic, 'payload': e.payload, 'occurred_at': e.occurred_at.isoformat()}
            for e in service.events.history() if e.topic != 'host.infer'] if service else []


@router.post('/context')
async def sync_context(body: StartRequest):
    service = current_service()
    if not service or not service.native_connected or not body.note_document_id or not service.matches_context(note_document_id=body.note_document_id):
        raise HTTPException(409, 'Perception is not active for this notebook page')
    try:
        await service.sync_note_context()
        return await status()
    except (RuntimeError, ValueError, OSError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc


class CaptureSourceRequest(BaseModel):
    note_document_id: str = Field(pattern=r"^[0-9a-f]{8,32}$")
    window_id: int = Field(ge=0, le=4294967295)


@router.get('/capture/sources')
async def capture_sources():
    service = current_service()
    if not service or not service.native_connected:
        raise HTTPException(409, '请先启动同桌感知，再选择窗口。')
    try:
        return await service.native_client.request('capture_sources', {})
    except (RuntimeError, OSError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post('/capture/source')
async def select_capture_source(body: CaptureSourceRequest):
    service = current_service()
    if not service or not service.native_connected or not service.matches_context(note_document_id=body.note_document_id):
        raise HTTPException(409, '感知未在当前笔记中启动。')
    try:
        await service.select_capture_source(body.window_id)
        return await status()
    except (RuntimeError, ValueError, OSError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc
