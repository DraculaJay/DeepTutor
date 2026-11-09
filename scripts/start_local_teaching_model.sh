#!/bin/bash
exec /Users/alexa/Developer/llama.cpp/build/bin/llama-server \
  -m /Users/alexa/Developer/AI-Deskmate-Models/MiniCPM-V-4.7-A3B/MiniCPM-V-4_7-35B-A3B-Q4_K_M.gguf \
  --mmproj /Users/alexa/Developer/AI-Deskmate-Models/MiniCPM-V-4.7-A3B/mmproj-model-f16.gguf \
  --host 127.0.0.1 --port 8081 -c 32768 --parallel 1 -ngl 99
