# Third-party notices

## CSSwitch

- Project: [SuperJJ007/CSSwitch](https://github.com/SuperJJ007/CSSwitch)
- Source commit: `4e0af6ba7909dca22f1257b168172ecbe4af4836`
- License: MIT
- Copyright: Copyright (c) 2026 shanjunjie
- Adapted concepts: PKCE loopback login, auth generations, atomic credential updates, model-catalog cache invalidation, and redacted operation states.

DeepTutor's Codex OAuth support draws on the design concepts listed above and
implements them independently against DeepTutor's own settings directory, model
catalog, and provider lifecycle. The MIT license text from that source commit
follows:

```text
MIT License

Copyright (c) 2026 shanjunjie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Hermes Agent

- Project: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- Source commit: `7d6db4efb885856078e4d19f804035226df81e0d`
- License: MIT
- Copyright: Copyright (c) 2025 Nous Research
- Adapted concepts: Feishu/Lark device-code bot registration and the WeCom AI
  Bot QR creation flow, including their retry and terminal-error semantics.

DeepTutor implements these protocols with its own async HTTP service, in-memory
session model, partner configuration merge, and Web administration interface.
The MIT license text from that source commit follows:

```text
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## thinking-orbs

- Project: [Jakubantalik/Libraries](https://github.com/Jakubantalik/Libraries) (`packages/thinking-orbs`)
- Source commit: `3862ffa345217443b63696a8c331a0664eea4b04`
- License: MIT
- Copyright: Copyright (c) 2026 Jakub Antalik
- Vendored files: `web/vendor/thinking-orbs/`

DeepTutor vendors this package's source rather than depending on the published
`thinking-orbs` npm package, so the dotted thought-orbs can take the host row's
`currentColor` instead of a flat greyscale ramp. Those local changes are listed at the top of
`web/vendor/thinking-orbs/index.ts` and marked at each site. Everything else is
upstream's, unmodified. The MIT license text from that source commit follows:

```text
MIT License

Copyright (c) 2026 Jakub Antalik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## AI Jarvis desktop perception integration

- Source: https://github.com/DraculaJay/pub-local-jarvis at `dd8fbf97a3e0f96239a0a465398654be68e88e15`.
- Reused Python control plane and native Worker/Scheduler; MIT License, copyright 2026 AI Jarvis contributors.
- License: `deeptutor/deskmate/vendor/LICENSE`. Integration changes are described in `docs/DESKMATE_INTEGRATION.md`.
- Optional llama.cpp-omni is pinned to `b9d15b83ee353b2eaeee4d9318c98a35a1347486`, with Jarvis's existing text-prefill patch. Its MIT license, authors and component licenses are preserved in `deeptutor/deskmate/vendor/llama.cpp-omni/`.
- The integration never downloads or bundles model weights. Upstream Jarvis's original notice about automatic model downloads describes the standalone upstream app, not DeepTutor's integration.
