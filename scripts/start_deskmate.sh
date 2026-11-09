#!/bin/bash
set -e
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export DEEPTUTOR_DESKMATE_SOURCE="$repo_root"
export DEEPTUTOR_PYTHON="$repo_root/.venv/bin/python"
model_root="/Users/alexa/Developer/AI-Deskmate-Models"
export DESKMATE_NATIVE_WORKER="$repo_root/native/deskmate/build-omni/deskmate-native-worker"
export DESKMATE_OMNI_MODEL_DIR="$model_root/MiniCPM-o-4.5"
export DESKMATE_OMNI_TTS=1
export JARVIS_REF_AUDIO_PATH="$model_root/MiniCPM-o-4.5/default_ref_audio.wav"
export DEEPTUTOR_NODE="$(command -v node)"
exec npm --prefix "$repo_root/apps/desktop" start
