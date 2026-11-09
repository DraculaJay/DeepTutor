# AI Deskmate integration prototype

Implementation date: 2026-11-09, Asia/Shanghai. Host baseline: DeepTutor `60fb3bdfddb30b7740c7ce3bd9b28d908f2af6db`, branch `deskmate/integration-mvp`; Jarvis reference `dd8fbf97a3e0f96239a0a465398654be68e88e15`. Both working trees were clean before implementation. Jarvis remains unchanged. No commit or push was performed.

The root and DeepTutor AGENTS.md and all three ai-deskmate-research documents were read. The current implementation prompt takes precedence over older research suggestions such as making MiniCPM mandatory or downloading weights on first run.

## Actual structure

```text
DeepTutor Electron → existing supervisor / SourceRuntime / ProcessGroup
  ├─ existing FastAPI backend
  │    └─ DeskmateService → reused Jarvis OrchestrationService / EventBus / policies
  │         ├─ existing DeepTutor BYOK completion + existing STT service
  │         ├─ existing Session / TimedMedia / Attachments / Co-Writer / Journal / Memory
  │         └─ private Unix socket → native Worker / LatestOnlyScheduler
  │              ├─ ScreenCaptureKit → VideoFrame
  │              ├─ Core Audio Process Tap → system-output PcmBlock
  │              ├─ NSWorkspace → foreground application
  │              └─ optional existing RealOmniRuntime → llama.cpp-omni / Metal
  └─ existing Next.js UI + small AI Deskmate control panel
```

The Python control plane runs inside the existing FastAPI process. This avoids a second HTTP service, credentials API and provider registry. The backend's native subprocess inherits the supervisor-managed process group. A FastAPI shutdown hook also closes it gracefully. No Jarvis Electron shell, launcher, model downloader or second desktop lifecycle was imported.

### Reuse and adaptation

- `deeptutor/deskmate/vendor/jarvis_backend`: copied relevant upstream Python modules, namespaced imports. OrchestrationService gains optional store injection. SceneHysteresis, CourseSceneStabilizer, BarragePolicy, EventBus, Lifecycle, prompts, transcript delta/cleanup and course recognition continue to execute upstream logic.
- `native/deskmate`: reused native Worker, LatestOnlyScheduler, FrameChangeDetector, ScreenIdleMonitor, audio downmix/resampling, runtime interface, original Omni adapter, binary protocol and tests. The macOS capture factories replace platform capture only. Monitoring/duplex code is compiled on Apple, and NSWorkspace replaces foreground-window checks in this macOS target.
- Frame header, version, CRC, existing message IDs and payload structure are retained. SNAPSHOT=13 is an explicit extension. Host-runtime inference uses a `host.infer` native event and a result frame. Native uint64 IDs are represented as decimal strings inside JSON, preventing loss through JavaScript numeric conversion.
- The normal runtime sends images through DeepTutor `complete(image_data=...)` and course audio through `transcribe_audio`. It never implements another provider or API-key manager. Native Omni is opt-in via an existing model directory and retains its original model-specific layout checks. Native duplex is available only on that optional runtime, not advertised for all BYOK models.
- The current screen tool is registered in the existing module/tool registry and mounted while capture is active in the current workspace. Its server-supplied session ID must match capture's learning session. A current image uses ToolResult.model_message, so raw screen pixels are not appended to durable chat messages. Passive events are not continuously written into chat history.

### Data ownership

The single course identity is the selected DeepTutor session ID. Timed-media material IDs are stable hashes derived from that ID, not an independent Jarvis course ID. The existing session preferences retain `deskmate_material_id` and the completed summary's `deskmate_summary_document_id`.

`HostCourses` implements the existing Jarvis course interface on TimedMediaStore. It does not create Jarvis state.json, transcript.md, a separate course database or desktop exports. Transcript cues retain system-audio provenance and capture-window bounds; these are **not word-aligned ASR timestamps**. Keyframes go into DeepTutor's existing attachment store and retain capture timestamps and source notes. The recent transcript is visible in the control panel; summaries link to the existing Co-Writer page.

Only a bounded, transient activity ring replaces Jarvis's independent MemoryStore. A finished course writes its summary/links to the existing LearningJournal and one `chat/course_completed` Memory TraceEvent. No new long-term memory database or surface is introduced. Existing consolidation and memory management remain unchanged. RAG indexing is not automatic; the existing knowledge workflow can ingest selected notes/materials.

Stopping capture clears live observation freshness. It preserves recordings and marks interrupted summaries as retryable failures. Summary generation uses the teaching provider in an asynchronous task; it does not submit a text task to the native Omni scheduler. A zero-content model response is an explicit failure, not an empty successful note.

### UI, permissions and lifecycle

The original DeepTutor interface is preserved. The small chat panel provides Start/Stop, separate screen/audio readiness, current scene/app/course, Jarvis companion/barrage text, transcript preview, summary link and actionable errors. User microphone input remains in the existing chat voice flow. System course audio cannot enter the user-command path. Full upstream floating pet/barrage windows and character animation were not migrated.

Screen capture and system audio start only after the user starts perception. The native adapter uses public ScreenCaptureKit/CoreAudio/NSWorkspace APIs; no private TCC API or automatic permission grant is used. A silent output device may not deliver audio callbacks until playback begins, so the UI distinguishes waiting for audio from screen readiness. The existing macOS app metadata gains capture purpose descriptions and retains microphone declarations.

The desktop supports an explicit development source launch through its existing supervisor. The existing arm64 bundle builder includes the prebuilt worker; model weights are excluded. Release signing/notarization and all-platform release requirements remain the original project's responsibility.

## Actual validation

| Check | Result and boundary |
|---|---|
| Python environment and backend | Full existing dependency set installed in `.venv`; real FastAPI startup completed; `/health/ready`, `/api/deskmate/status`, `/api/deskmate/events` returned 200 in an isolated profile |
| Next.js production build | Passed, including TypeScript and 46 prerendered pages |
| Desktop checks | `npm run check` passed; existing desktop suite: 23 passed after rerunning outside the socket-restricted sandbox |
| Python targeted checks | 37 passed: 5 new adapter unit tests + existing video-learning and tool-registry tests. New adapter tests use explicit synthetic fixtures and are not evidence of real model/capture behavior |
| Native build/tests | Apple Silicon native worker built; reused native suite passed, including the now-enabled Apple monitoring/duplex **fixture** tests |
| Real process/IPC | Real worker spawned; ping returned the actual foreground app; binary Unix socket round-trip passed with an explicitly labelled protocol fixture; exit code 0, socket directory removed; stop is idempotent |
| Real screen capture | ScreenCaptureKit delivered actual 1280×827 BGRA frames; no captured screen was sent to a cloud service |
| Real system audio | Local, quiet synthetic three-second tone played through system output; Core Audio tap delivered nonzero PCM. Measured mean-square sample power was approximately 0.000175 and 0.000130 in captured windows; subsequent silent window was 0. Native capture process exited 0 |
| Optional Omni build | Full checksum-pinned source obtained using Jarvis's existing acquisition script; existing text-prefill patch applied only to build-local copy. RealOmniRuntime + llama.cpp-omni + Metal executable compiled and linked. No model weights downloaded/loaded; duplex inference not runtime-tested |
| Real teaching/provider + persistence | Existing local `qwen3:30b-a3b-instruct-2507-q4_K_M` called through DeepTutor's actual provider using synthetic lesson text. Nonempty teaching explanation and course summary returned; actual Co-Writer, journal and Memory writes completed in an isolated test home. This validates transport/storage, not a teaching-quality benchmark |
| Real desktop UI | Electron launched the original DeepTutor UI through its supervisor; the AI Deskmate panel and controls were observed in the native app. Smoke-test processes were then closed; backend graceful shutdown completed and no test supervisor/frontend/capture worker remained |

An initial real call to local thinking model `qwen3.6:35b-a3b` exhausted a small output budget and returned no content. The resulting empty-summary handling bug was fixed and the successful provider test used the installed non-thinking Instruct model. No cloud-tagged Ollama model was used, and no weights were downloaded.

The incomplete reference vendor tree genuinely lacked model implementation headers. This was resolved for the optional build by fetching the already pinned, checksum-verified **source** into a separate build cache; the reference checkout was not edited. OpenSSL was disabled for local Omni inference to avoid introducing a Homebrew dylib dependency into the worker.

## Remaining validation and limitations

- The desktop test profile starts with no provider/STT credentials. Configure existing DeepTutor Language Models and Voice/STT before using default BYOK perception. No existing user credentials were copied into the test profile.
- Real STT-provider transcription, native-Omni model loading/full duplex, and the complete live-course → perception model → user question → transcript/keyframe → summary sequence have not been verified together. Fixture adapter tests and independent capture/provider smoke tests do not count as that end-to-end pass.
- Real course scene/recognition accuracy, long-duration thermal/performance behavior, microphone conversation, packaging into a signed/notarized DMG and all-platform release validation remain unverified. No release was published.
- A recording's transcript times are capture-window bounds, and the native worker retains upstream latest-only scheduling/audio-window limits. This is a prototype, not a lossless lecture recorder or word-level subtitle aligner.
- Course summary quality remains model-dependent; the real text smoke test is not the seven-part model benchmark in LOCAL_MODEL_RESEARCH.md.

See [MACOS_SETUP.md](MACOS_SETUP.md) for copyable install/build/start commands. The working branch has uncommitted source changes, intentionally without Git checkpoints because the user explicitly prohibited committing.


## Note-scoped perception (2026-11-09)

The first note-workspace slice connects Jarvis to the existing Co-Writer Block page; it does not replace the editor, Provider registry, document store, sessions or review workflow. The original standalone AI Deskmate checkout and its data remain untouched.

- A note page has a small **同桌感知** bar. Start flushes the page, creates/reuses an ordinary DeepTutor note conversation, and starts the existing Native Worker. No first chat message is required.
- The shared context contains bounded saved note text, its parent-page path, the current question, selected passage when available, and the last completed answer. It is refreshed at start, before a note question, after a completed answer, and by **同步笔记**. Reopening capture restores recent question/answer text from the existing session store. It does not mirror every edit or the entire conversation history continuously.
- Additive RPC command 14 carries UTF-8 learning-context JSON through Jarvis's existing framing. The Worker appends it as source data to structured perception and Duplex instructions. Changes reuse the existing Duplex maintenance thread, retaining the LLM weights; stale answers from another note thread cannot replace a newer question's focus. Existing protocol numbers and upstream runtime pin remain unchanged.
- The note agent automatically receives the same page's latest perception snapshot; `screen_context` can obtain a fresh image. Multiple question threads on the same note can use its shared perception. Another note or unrelated chat cannot access the active page's capture. Switching pages requires stopping the previous capture explicitly.
- **问当前画面** and **整理成笔记** reuse the open/recent page conversation. Notes are proposed through existing `note_read` / `screen_context` / `note_suggest`; the learner accepts or ignores them in the existing inline review. Capturing never overwrites the page body.

Validation: 7 Python integration/boundary tests passed; TypeScript passed; native CTest passed, including note context reaching both structured perception and Duplex and changed context reaching a rebuilt Duplex session. Real Electron verification started native Omni from a Block page, answered a note-content question through local A3B, observed question and answer acknowledgements in the Native Worker, rejected another page's sync, and preserved the document revision. A second real page turn produced a pending insert suggestion through all three existing note/screen tools; the suggestion remains unaccepted for inspection. Frontend ESLint reported no errors and existing-style literal-text localization warnings in the new control.

The app still opens at its existing home: note-first startup, migration of the original editor/workspace and the Jarvis avatar are subsequent slices, per the user's request to connect perception first. Long-term Course memory, audio transcription quality, prolonged course acceptance and native PCM playback retain the limitations documented above.


## Screen/window capture selection

The notebook's 同桌感知 bar now includes 感知范围 and 刷新窗口. Start perception, wait for the first frame, then choose a named application window or 整个屏幕. Selecting Chrome pins that window through the existing ScreenCaptureKit stream: returning to DeepTutor does not replace its image with the notebook UI. The selection lasts for the current capture session; restarting perception defaults to the existing whole-display capture. No automatic capture on app launch was added. System audio still comes from computer output, independently of the selected window.

Window enumeration includes other macOS Spaces and shows titled windows of ordinary applications. The original NSWorkspace foreground lookup was first initialized on a background thread and could stay stale; it is now observed on the native main run loop. Window selection uses the existing native socket protocol (15: list, 16: select). Snapshots carry source IDs; switching clears previous frames/observations, rejects a closed window, and waits for a matching new frame before enabling screen questions. A stream failure is surfaced instead of continuing to advertise the last image as ready. Native startup and source changes are serialized so a selection cannot wait on a stream that has not been created yet.

Validation (2026-11-09): Omni and BYOK native builds passed; existing native CTest passed with source-switch/old-frame checks; 8 targeted Python tests passed; TypeScript passed. A real native socket capture selected Chrome, rejected an unavailable window ID, and restored whole-screen capture. In the actual Electron window the picker selected Chrome; native Omni then described the BlockNote GitHub page while the learner was using the notebook. The learner confirmed switching back still recognized the browser. Block editor content and behavior were not modified.


## Block interaction iteration (2026-11-09)

Branch `codex/restore-deeptutor-blocks` keeps the existing DeepTutor BlockNote editor and all perception wiring. Interaction references are the old AI Deskmate commits `a44078e` and `0e5d2bd`; the old Tauri checkout and its Draft/Note data are untouched.

The gutter now separates a drag handle and an actions menu; a portal places the independent insert button between blocks. Pointer capture, a 5 px threshold, Escape/blur cancellation and edge scrolling reuse the prior interaction approach. Top/bottom drop strips reorder; left/right create existing `noteColumns`/`noteColumn` containers; the centre creates the same containers with the minimal `mode: wrap` prop. Dropping centrally on a toggle moves an intact subtree into `children` and expands its parent. Moving out dissolves empty layout wrappers. Original block IDs, bodies, child order and source properties remain intact; only new layout containers get new IDs.

Toggle Heading keeps its existing saved `collapsed` prop. Toggle List reuses BlockNote's original frame, keyboard rules and parser, extending its props with `collapsed`; browser-local state is imported for legacy blocks when available. The note JSON is authoritative for the new persisted state. No database migration, replacement editor or added package is involved.

Automated validation: 8 frontend structure/interaction checks, including mounted React BlockNote layout undo/redo and Toggle List clicks; 27 Python note/storage/perception checks; TypeScript and targeted ESLint passed. Human desktop acceptance for the newly loaded version and application restart recovery remains pending.

Development desktop caveat: the source runtime stages `web` into `Open DeepTutor/cache/deskmate-source/web`; editing the repository does not update that running copy automatically. Refresh the staged frontend (or restart the existing desktop core) before interpreting native UI results. The initial human drag feedback in this iteration was against the old staged editor and is not acceptance of the new spatial behavior.
