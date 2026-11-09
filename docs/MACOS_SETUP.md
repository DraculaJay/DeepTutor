# AI Deskmate macOS setup

Target: Apple Silicon, macOS 14.2+, Python 3.12, Node 22+, Xcode command-line tools, uv. DeepTutor remains the only Electron application. No model weights are installed automatically.

## Install and build

```bash
cd /Users/alexa/Developer/AI-Deskmate/DeepTutor
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements/full.txt cmake ninja
npm --prefix web ci --legacy-peer-deps
npm --prefix apps/desktop ci
# If npm blocks Electron's install script, explicitly install its pinned executable:
(cd apps/desktop && node node_modules/electron/install.js)
.venv/bin/cmake -S native/deskmate -B native/deskmate/build -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$PWD/.venv/bin/ninja" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64
.venv/bin/cmake --build native/deskmate/build -j 6
```

These dependencies and the default native worker have already been installed/built on the implementation machine. For ordinary subsequent launches:

```bash
cd /Users/alexa/Developer/AI-Deskmate/DeepTutor
./scripts/start_deskmate.sh
```

The script uses the existing desktop supervisor's source mode. Its backend and Next.js processes and the backend's native worker belong to the existing managed process group. Closing the desktop closes its services. The default profile is the desktop's existing `~/Library/Application Support/Open DeepTutor/workspace`; no second provider or credential store is created. For a separate test profile set `OPEN_DEEPTUTOR_TEST_HOME` before starting.

## Configure and use

1. In DeepTutor Settings, configure and select the existing Language Model provider. The default perception path needs image support. Configure the existing Voice/STT provider as well; system course audio uses that STT selection. Local provider URLs, keys and capability overrides remain in DeepTutor's existing settings.
2. Start a normal chat and send a message to create the learning session. Open **AI Deskmate** at the lower right and choose **启动感知**. Capture is opt-in, not automatic on application launch.
3. Allow Screen Recording and System Audio Recording for the responsible launching application. In development that can be the terminal/IDE; a packaged build uses DeepTutor's application identity. The app declares `NSAudioCaptureUsageDescription` and preserves the existing microphone usage declaration. There are no private TCC calls.
4. If denied, use System Settings → Privacy & Security → Screen & System Audio Recording, then restart the launching application. A screen can be ready while the audio stream waits for system playback; these states are shown separately.
5. Play a course. Jarvis stabilizes the scene, records system-audio transcript deltas and requests keyframes. Ask questions in the **same chat**; `screen_context` is mounted on demand and returns timestamped observations and a private current-screen image to the agent. Screen/course content is source material, not user instructions. User microphone input stays on DeepTutor's existing voice-input path.
6. Choose **结束课程 / 重试总结** to generate a teaching-model summary in Co-Writer. The original transcript/keyframes stay in DeepTutor's TimedMedia/attachment stores if summary generation fails. Stop capture before switching its learning session. A stop interrupts any unfinished summary and leaves a retryable recording.

If using a cloud BYOK model or STT service, the screen/audio selected by starting perception goes to that configured provider. Local-only use requires local endpoints. This integration does not silently replace a missing STT provider or download one.

## Optional native Omni / full duplex

This is optional, and uses Jarvis's existing RealOmniRuntime. The reference checkout's vendor tree was incomplete on the implementation machine. Its existing acquisition script obtains the full **source**, verifies its pinned SHA-256, and does not fetch model weights:

```bash
cd /Users/alexa/Developer/AI-Deskmate/DeepTutor
.venv/bin/cmake -DJARVIS_RUNTIME_SOURCE_CACHE="$PWD/native/deskmate/.cache" \
  -P native/deskmate/third_party/runtime/cmake/AcquireUpstream.cmake
.venv/bin/cmake -S native/deskmate -B native/deskmate/build-omni -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$PWD/.venv/bin/ninja" \
  -DJARVIS_RUNTIME_ENABLE_UPSTREAM=ON \
  -DJARVIS_RUNTIME_UPSTREAM_SOURCE_DIR="$PWD/native/deskmate/.cache/llama.cpp-omni-b9d15b83ee353b2eaeee4d9318c98a35a1347486" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DBUILD_TESTING=OFF
.venv/bin/cmake --build native/deskmate/build-omni --target deskmate-native-worker -j 6
# Supply an existing, user-chosen model directory with Jarvis's supported layout:
DESKMATE_NATIVE_WORKER="$PWD/native/deskmate/build-omni/deskmate-native-worker" \
DESKMATE_OMNI_MODEL_DIR="/absolute/path/to/your/existing/omni-model-directory" \
./scripts/start_deskmate.sh
```

The build applies the original Jarvis patch only to its build-local source copy. It uses Metal and disables optional CoreML artifacts and HTTPS code that local inference does not need. The sibling Jarvis checkout remains read-only. On 2026-11-09, user-requested MiniCPM-o 4.5 weights were completed and hash-verified. The real worker loaded the model, Duplex processed 12 fixed image/audio frames and produced text plus a 24 kHz WAV through the existing TTS/token2wav. Full course quality remains unverified. Native PCM playback is not connected to the desktop text bridge.

## Checks

```bash
.venv/bin/cmake --build native/deskmate/build
.venv/bin/ctest --test-dir native/deskmate/build --output-on-failure
npm --prefix apps/desktop run check
npm --prefix apps/desktop test
npm --prefix web run build
```

Focused Python adapter tests are in `tests/deskmate/test_integration.py`; use an isolated `DEEPTUTOR_HOME` when running tests. The integration record distinguishes fixture tests, real capture, real provider calls, and unverified end-to-end paths.

## Packaging

The existing arm64 runtime builder copies the prebuilt native executable into the sealed core. Build the native worker first; it does not bundle model directories. Existing runtime signing also signs nested Mach-O binaries. Follow the original desktop release process, which snapshots committed HEAD. This task did not commit, push, publish a release, create a DMG or perform notarization. Intel/Windows retain their original host capabilities; the new capture adapter targets macOS first.

## Local model configuration (2026-11-09)

The launcher now selects `native/deskmate/build-omni/deskmate-native-worker`, the user-selected `~/Developer/AI-Deskmate-Models/MiniCPM-o-4.5` directory, `DESKMATE_OMNI_TTS=1`, and its existing `default_ref_audio.wav`. No weights download on launch. Omni starts only when perception is started in a chat. Native Omni handles its own audio input; the separate BYOK/STT route above still applies when running without native Omni. Existing desktop PCM playback has not been added.

DeepTutor's existing model catalog now selects `llama_cpp` at `http://127.0.0.1:8081/v1`, with the absolute MiniCPM-V-4.7-A3B Q4_K_M GGUF path as the model ID. The existing server uses the matching `mmproj-model-f16.gguf`, a 32768-token context with one server slot, and Metal. Text, vision, and a function call were tested through the original provider path. The launcher reuses the independently running server and does not spawn or stop it. Preserve that server when closing the desktop.

The native model requires its main Q4_K_M GGUF, vision F16 GGUF, audio F16 GGUF, `tts/MiniCPM-o-4_5-tts-F16.gguf`, `tts/MiniCPM-o-4_5-projector-F16.gguf`, and `token2wav-gguf/{encoder,flow_matching,flow_extra,hifigan2,prompt_cache}.gguf`. All are present and SHA-256 verified. CoreML and Python token2wav weights are unnecessary for this Metal/C++ build. The original model catalog is backed up alongside it as `model_catalog.before-local-minicpm.json`.

Validation limits: a fixed Chinese audio clip with a blank image produced the correct `7加8等于15。` across two Duplex frames and generated speech; independent simplex transcription tests produced unrelated output and have not passed acceptance. A live perception run also emitted one malformed JSON response. Full course stability and speech accuracy remain pending; successful weight loading does not imply those quality checks passed.

Context correction: real DeepTutor Agent prompts exceeded the initial 8192-token server limit (8738 and 10747 tokens observed). Both the existing catalog and llama.cpp service now use 32768; server flags are `-c 32768 --parallel 1`. A real 10837-token prompt completed successfully after this change. The desktop settings API applied the catalog and reset the existing client caches; no chat history was removed. Use the updated local teaching-model launcher and tutorial for subsequent starts.

Upstream CLI argument reference: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md

## Saved integration checkpoint

This checkpoint preserves the working integration before the note-centered workspace phase. Current limitations remain: perception and Q&A use separate model contexts bridged on demand through `screen_context`; the Jarvis avatar window has not been ported; native speech generation works but desktop PCM playback is not connected; complete live-course quality and long-running stability are pending acceptance.

Start the existing A3B service with `./scripts/start_local_teaching_model.sh` (32768 context, one slot), then start the existing desktop with `./scripts/start_deskmate.sh`. The teaching-model script loads only the existing local weights and is an ordinary llama.cpp invocation. If the existing service is already running, reuse it rather than starting another copy.

The local model catalog, credentials, chat data, model weights, generated audio and native build trees are not part of this source checkpoint. Recreate the local Provider from the configuration described above; build the native worker from its pinned source before using it on another machine.
