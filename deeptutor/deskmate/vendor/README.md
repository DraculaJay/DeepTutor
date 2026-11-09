# Reused Jarvis code

Source: pub-local-jarvis `dd8fbf97a3e0f96239a0a465398654be68e88e15`, MIT.

This copy contains the Python control plane, policies and prompts, not its Electron shell, launcher or model downloader. Imports are namespaced under `deeptutor.deskmate.vendor`.

Local changes: optional constructor injection of activity/course stores; the existing binary protocol gains SNAPSHOT=13, and the RPC client waits for snapshot results. Existing protocol numbers and frame structures are preserved. DeepTutor injects its TimedMedia course adapter and an in-memory activity buffer; Jarvis's persistent MemoryStore/CourseRepository are never instantiated by this integration. Their original implementations remain as upstream reference dependencies for types and utility code.

The original upstream THIRD_PARTY_NOTICES.md is preserved for provenance. Its automatic-weight-download paragraph does not describe this integration: no model downloader is included or called. Optional inference-runtime licenses and authors are preserved in llama.cpp-omni/.

Note-perception integration adds LEARNING_CONTEXT=14 on the existing frame protocol. It carries bounded notebook/question data to the existing native Worker; it is not a second runtime, provider or credential store.
