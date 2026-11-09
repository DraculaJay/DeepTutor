"""Jarvis course interface backed by DeepTutor timed media, using its session ID."""
from __future__ import annotations
from collections import deque
from datetime import UTC, datetime
import hashlib
from .vendor.jarvis_backend.courses import CourseState, CourseStatus
from .vendor.jarvis_backend.memory import MemoryEvent


def now() -> str:
    return datetime.now(UTC).isoformat()


class ActivityBuffer:
    """Only transient activity; learning events are persisted by finish_course."""
    def __init__(self):
        self._events = deque(maxlen=100)

    def events(self):
        return list(self._events)

    def append(self, kind, text, metadata):
        from uuid import uuid4
        event = MemoryEvent(uuid4().hex, now(), kind, text, metadata)
        self._events.append(event)
        return event

    @staticmethod
    def event_day(event):
        return datetime.fromisoformat(event.timestamp.replace('Z', '+00:00')).astimezone().date()


class TranscriptView:
    def __init__(self, session):
        self.session = session

    def read_text(self, **kwargs):
        return '\n'.join(c['text'] for c in self.session.material['transcript']['cues'])


class HostCourse:
    def __init__(self, repository, material_id):
        self.repository, self.material_id = repository, material_id
        self.transcript_path = TranscriptView(self)

    @property
    def material(self):
        return self.repository.store.get(self.material_id)

    @property
    def state(self):
        m = self.material
        return CourseState.from_dict(m['deskmate'])

    def append_transcript(self, text, **kwargs):
        from deeptutor.video_learning.service import build_segments
        with self.repository.store.lock(self.material_id):
            m = self.material
            if m['deskmate']['status'] != 'recording':
                raise RuntimeError('Course is not recording')
            end = max(0.0, (datetime.now(UTC) - datetime.fromisoformat(m['deskmate']['created_at'])).total_seconds())
            cues = m['transcript']['cues']
            start = cues[-1]['end'] if cues else 0.0
            # These are capture-window bounds, not word-aligned ASR timestamps.
            cues.append({'start': start, 'end': max(start + .001, end), 'text': text,
                         'source': 'system_audio', 'timing': 'capture_window'})
            m['metadata']['duration_seconds'] = end
            m['segments'] = build_segments(cues)
            m['deskmate']['updated_at'] = now()
            self.repository.store.save(m)
        return self.state

    def update_summary(self, summary):
        self.update(summary=summary.strip())
        return self.state

    def update(self, **fields):
        with self.repository.store.lock(self.material_id):
            m = self.material
            m['deskmate'].update(fields, updated_at=now())
            self.repository.store.save(m)


class HostCourses:
    def __init__(self, store, session_id):
        self.store, self.session_id = store, session_id
        self.material_id = hashlib.sha256(f'deskmate:{session_id}'.encode()).hexdigest()[:32]

    def create(self, title, *, session_id=None):
        existing = self.sessions()
        if existing:
            course = existing[0]
            # Resume the same authoritative session/material after a stop.
            course.update(status='recording', error=None)
            return course
        state = CourseState(self.session_id, title, CourseStatus.RECORDING, now(), now())
        self.store.save({'version': 1, 'type': 'timed_media', 'material_id': self.material_id,
                         'created_at': now(), 'source': {'provider': 'deskmate', 'session_id': self.session_id},
                         'metadata': {'title': title, 'duration_seconds': 0},
                         'transcript': {'status': 'ready', 'source': 'system_audio', 'language': '', 'cues': []},
                         'segments': [], 'learning': {'last_position': 0},
                         'deskmate': state.as_dict(), '_caption_text_version': 1})
        return self.open(self.session_id)

    def open(self, session_id):
        if session_id != self.session_id:
            raise ValueError('Course must belong to the active DeepTutor session')
        self.store.get(self.material_id)
        return HostCourse(self, self.material_id)

    def sessions(self):
        from deeptutor.video_learning.service import TimedMediaNotFound
        try:
            return [self.open(self.session_id)]
        except TimedMediaNotFound:
            return []
